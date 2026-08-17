import { createHash } from 'node:crypto'
import { cellEnergy, desiredPopulation, ecosystemStats } from './ecology'
import { rng } from './prng'
import type { FishIdentity, Grid, Plan, Species } from './types'

export const POND_STATE_VERSION = 2
const SHA256 = /^[a-f0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export interface PondGenerator {
  repository: string
  sha: string
}

export interface PersistentFish extends FishIdentity {
  lastFedOn: string
}

export interface PondProof {
  algorithm: 'sha256'
  sourceDigest: string
  previousDigest: string | null
  digest: string
}

export interface PondState {
  version: typeof POND_STATE_VERSION
  owner: string
  seed: string
  revision: number
  updatedOn: string
  fish: PersistentFish[]
  snapshot: Record<string, number>
  lastDelta: Record<string, number>
  generator: PondGenerator | null
  proof: PondProof
}

export interface PondProvenance {
  schema: 'koipond-state-v2'
  owner: string
  revision: number
  updatedOn: string
  sourceDigest: string
  previousDigest: string | null
  stateDigest: string
  generator: PondGenerator | null
}

export interface PreparedPondState {
  state: PondState
  identities: FishIdentity[]
  deltaByCell: Map<number, number>
  dateByCell: Map<number, string>
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot hash a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`)
      .join(',')}}`
  }
  throw new Error(`Cannot hash ${typeof value}`)
}

export const sha256 = (value: unknown): string => createHash('sha256').update(canonicalJSON(value)).digest('hex')

function parseFish(value: unknown): PersistentFish[] | null {
  if (!Array.isArray(value) || value.length > 4) return null
  const fish = value.filter((entry): entry is PersistentFish => {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as Partial<PersistentFish>
    return (
      typeof candidate.key === 'string' &&
      /^[a-z0-9-]{1,128}$/i.test(candidate.key) &&
      (candidate.species === 'koi' || candidate.species === 'minnow') &&
      finiteNumber(candidate.baseSize) &&
      candidate.baseSize >= 0.4 &&
      candidate.baseSize <= 2.5 &&
      finiteNumber(candidate.lifetimeEnergy) &&
      candidate.lifetimeEnergy >= 0 &&
      candidate.lifetimeEnergy <= 1_000_000_000 &&
      isoDate(candidate.bornOn) &&
      isoDate(candidate.lastFedOn)
    )
  })
  if (fish.length !== value.length || new Set(fish.map(entry => entry.key)).size !== fish.length) return null
  return fish.map(entry => ({ ...entry }))
}

function parseEnergyRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record: Record<string, number> = {}
  for (const [date, energy] of Object.entries(value)) {
    if (!isoDate(date) || !finiteNumber(energy) || !Number.isInteger(energy) || energy < 0 || energy > 7) return null
    record[date] = energy
  }
  return record
}

export function parsePondGenerator(value: unknown): PondGenerator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const generator = value as Partial<PondGenerator>
  if (!REPOSITORY.test(generator.repository ?? '') || !COMMIT_SHA.test(generator.sha ?? '')) return null
  return { repository: generator.repository as string, sha: generator.sha as string }
}

function statePayload(state: PondState): unknown {
  return {
    version: state.version,
    owner: state.owner,
    seed: state.seed,
    revision: state.revision,
    updatedOn: state.updatedOn,
    fish: state.fish,
    snapshot: state.snapshot,
    lastDelta: state.lastDelta,
    ...(state.generator ? { generator: state.generator } : {}),
    proof: {
      algorithm: state.proof.algorithm,
      sourceDigest: state.proof.sourceDigest,
      previousDigest: state.proof.previousDigest,
    },
  }
}

export const sourceDigestFor = (owner: string, snapshot: Record<string, number>): string =>
  sha256({ owner, snapshot })

export const stateDigestFor = (state: PondState): string => sha256(statePayload(state))

function signed(state: PondState): PondState {
  const copy: PondState = {
    ...state,
    fish: state.fish.map(fish => ({ ...fish })),
    snapshot: { ...state.snapshot },
    lastDelta: { ...state.lastDelta },
    generator: state.generator ? { ...state.generator } : null,
    proof: { ...state.proof },
  }
  copy.proof.digest = stateDigestFor(copy)
  return copy
}

function parseCommon(value: Record<string, unknown>, owner: string, seed: string) {
  if (
    value.owner !== owner ||
    value.seed !== seed ||
    !finiteNumber(value.revision) ||
    value.revision < 0 ||
    !Number.isInteger(value.revision) ||
    !isoDate(value.updatedOn)
  ) {
    return null
  }
  const fish = parseFish(value.fish)
  const snapshot = parseEnergyRecord(value.snapshot)
  if (!fish || !snapshot) return null
  return { fish, snapshot, revision: value.revision, updatedOn: value.updatedOn }
}

export function parsePondState(value: unknown, owner: string, seed: string): PondState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const common = parseCommon(raw, owner, seed)
  if (!common) return null

  if (raw.version === 1) {
    return signed({
      version: POND_STATE_VERSION,
      owner,
      seed,
      revision: common.revision,
      updatedOn: common.updatedOn,
      fish: common.fish,
      snapshot: common.snapshot,
      lastDelta: {},
      generator: null,
      proof: {
        algorithm: 'sha256',
        sourceDigest: sourceDigestFor(owner, common.snapshot),
        previousDigest: null,
        digest: '',
      },
    })
  }
  if (raw.version !== POND_STATE_VERSION) return null

  const lastDelta = parseEnergyRecord(raw.lastDelta)
  const proof = raw.proof as Partial<PondProof> | undefined
  if (
    !lastDelta ||
    !proof ||
    proof.algorithm !== 'sha256' ||
    !SHA256.test(proof.sourceDigest ?? '') ||
    (proof.previousDigest !== null && !SHA256.test(proof.previousDigest ?? '')) ||
    !SHA256.test(proof.digest ?? '')
  ) {
    return null
  }
  for (const [date, delta] of Object.entries(lastDelta)) {
    if (common.snapshot[date] === undefined || delta > common.snapshot[date]) return null
  }
  const generator = raw.generator === undefined || raw.generator === null ? null : parsePondGenerator(raw.generator)
  if (raw.generator !== undefined && raw.generator !== null && !generator) return null

  const state: PondState = {
    version: POND_STATE_VERSION,
    owner,
    seed,
    revision: common.revision,
    updatedOn: common.updatedOn,
    fish: common.fish,
    snapshot: common.snapshot,
    lastDelta,
    generator,
    proof: {
      algorithm: 'sha256',
      sourceDigest: proof.sourceDigest as string,
      previousDigest: proof.previousDigest as string | null,
      digest: proof.digest as string,
    },
  }
  if (state.proof.sourceDigest !== sourceDigestFor(owner, state.snapshot)) return null
  if (state.proof.digest !== stateDigestFor(state)) return null
  return state
}

export function verifyPondState(value: unknown): PondState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== POND_STATE_VERSION || typeof raw.owner !== 'string' || typeof raw.seed !== 'string') return null
  return parsePondState(value, raw.owner, raw.seed)
}

function newFish(index: number, grid: Grid, owner: string, seed: string, bornOn: string): PersistentFish {
  const stats = ecosystemStats(grid)
  const random = rng(`identity:${seed}:${index}`)
  const energyDensity = Math.min(1, stats.energyDensity / 7)
  const koiAffinity = Math.min(0.78, 0.26 + energyDensity * 0.34 + stats.consistency * 0.42)
  const species: Species = index === 0 || random() < koiAffinity ? 'koi' : 'minnow'
  const baseSize =
    index === 0
      ? 1.08 + energyDensity * 0.2 + random() * 0.08
      : species === 'koi'
        ? 0.68 + energyDensity * 0.14 + random() * 0.12
        : 0.9 + stats.consistency * 0.18 + random() * 0.14
  return {
    key: `${owner.toLowerCase()}-${index}-${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}`,
    species,
    baseSize,
    lifetimeEnergy: 0,
    bornOn,
    lastFedOn: bornOn,
  }
}

export function preparePondState(
  grid: Grid,
  owner: string,
  seed: string,
  previousValue: unknown = null,
  generator?: PondGenerator,
): PreparedPondState {
  const previous = parsePondState(previousValue, owner, seed)
  const currentGenerator = generator ?? previous?.generator ?? null
  const ordered = [...grid.cells].sort((a, b) => a.date.localeCompare(b.date))
  const updatedOn = ordered.at(-1)?.date ?? previous?.updatedOn ?? '1970-01-01'
  const snapshot: Record<string, number> = {}
  const currentDelta: Record<string, number> = {}
  const deltaByCell = new Map<number, number>()
  const dateByCell = new Map<number, string>()

  for (const cell of grid.cells) {
    const energy = cellEnergy(cell)
    const key = cell.week * 7 + cell.day
    snapshot[cell.date] = energy
    dateByCell.set(key, cell.date)
    const delta = Math.max(0, energy - (previous?.snapshot[cell.date] ?? 0))
    if (delta > 0) {
      currentDelta[cell.date] = delta
      deltaByCell.set(key, delta)
    }
  }

  const population = desiredPopulation(ecosystemStats(grid))
  const fish = (previous?.fish ?? []).map(entry => ({ ...entry }))
  const firstActiveOn = ordered.find(cell => cell.level > 0)?.date ?? updatedOn
  const bornOn = previous ? updatedOn : firstActiveOn
  while (fish.length < population) fish.push(newFish(fish.length, grid, owner, seed, bornOn))

  const snapshotChanged = canonicalJSON(previous?.snapshot ?? {}) !== canonicalJSON(snapshot)
  const populationChanged = fish.length !== (previous?.fish.length ?? 0)
  const generatorChanged = canonicalJSON(previous?.generator ?? null) !== canonicalJSON(currentGenerator)
  const changed = !previous || snapshotChanged || populationChanged || generatorChanged
  const revision = (previous?.revision ?? 0) + (changed ? 1 : 0)
  const lastDelta = snapshotChanged || !previous ? currentDelta : populationChanged || generatorChanged ? {} : previous.lastDelta
  const state = signed({
    version: POND_STATE_VERSION,
    owner,
    seed,
    revision,
    updatedOn,
    fish,
    snapshot,
    lastDelta: { ...lastDelta },
    generator: currentGenerator,
    proof: {
      algorithm: 'sha256',
      sourceDigest: sourceDigestFor(owner, snapshot),
      previousDigest: previous ? (changed ? previous.proof.digest : previous.proof.previousDigest) : null,
      digest: '',
    },
  })

  return {
    state,
    identities: fish.map(({ key, species, baseSize, lifetimeEnergy, bornOn }) => ({
      key,
      species,
      baseSize,
      lifetimeEnergy,
      bornOn,
    })),
    deltaByCell,
    dateByCell,
  }
}

export function finalizePondState(prepared: PreparedPondState, plan: Plan): PondState {
  const fishByKey = new Map(prepared.state.fish.map(fish => [fish.key, fish]))
  for (const event of plan.eats) {
    const delta = prepared.deltaByCell.get(event.cell) ?? 0
    if (delta === 0) continue
    const identity = plan.fishes[event.fish]
    const fish = identity ? fishByKey.get(identity.key) : null
    if (!fish) continue
    fish.lifetimeEnergy += delta
    fish.lastFedOn = prepared.dateByCell.get(event.cell) ?? fish.lastFedOn
  }
  prepared.state.proof.digest = stateDigestFor(prepared.state)
  return prepared.state
}

export function provenanceFor(state: PondState): PondProvenance {
  return {
    schema: 'koipond-state-v2',
    owner: state.owner,
    revision: state.revision,
    updatedOn: state.updatedOn,
    sourceDigest: state.proof.sourceDigest,
    previousDigest: state.proof.previousDigest,
    stateDigest: state.proof.digest,
    generator: state.generator ? { ...state.generator } : null,
  }
}

export function highlightedCells(grid: Grid, state: PondState): Set<number> {
  return new Set(
    grid.cells
      .filter(cell => (state.lastDelta[cell.date] ?? 0) > 0)
      .map(cell => cell.week * 7 + cell.day),
  )
}

export function serializePondState(state: PondState): string {
  return `${JSON.stringify(signed(state), null, 2)}\n`
}
