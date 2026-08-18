import { canonicalJSON, statePayloadForHash } from '../state-canonical'
import type { PersistentFish, PondGenerator, PondProvenance, PondState } from '../state'

const SHA256 = /^[a-f0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type VerificationStatus = 'pass' | 'recorded' | 'fail'

export interface VerificationCheck {
  id: 'state' | 'source' | 'svg' | 'generator' | 'freshness' | 'history'
  title: string
  status: VerificationStatus
  detail: string
  value?: string
}

export interface PondVerification {
  valid: boolean
  state: PondState | null
  checks: VerificationCheck[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseGenerator(value: unknown): PondGenerator | null {
  if (!isRecord(value) || !REPOSITORY.test(String(value.repository ?? '')) || !COMMIT_SHA.test(String(value.sha ?? ''))) {
    return null
  }
  return { repository: String(value.repository), sha: String(value.sha) }
}

function parseEnergyRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null
  const record: Record<string, number> = {}
  for (const [date, energy] of Object.entries(value)) {
    if (!isoDate(date) || !Number.isInteger(energy) || Number(energy) < 0 || Number(energy) > 7) return null
    record[date] = Number(energy)
  }
  return record
}

function parseFish(value: unknown): PersistentFish[] | null {
  if (!Array.isArray(value) || value.length > 4) return null
  const fish: PersistentFish[] = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    if (
      typeof entry.key !== 'string' ||
      !/^[a-z0-9-]{1,128}$/i.test(entry.key) ||
      (entry.species !== 'koi' && entry.species !== 'minnow') ||
      !finite(entry.baseSize) || entry.baseSize < 0.4 || entry.baseSize > 2.5 ||
      !finite(entry.lifetimeEnergy) || entry.lifetimeEnergy < 0 || entry.lifetimeEnergy > 1_000_000_000 ||
      !isoDate(entry.bornOn) || !isoDate(entry.lastFedOn)
    ) return null
    fish.push({
      key: entry.key,
      species: entry.species,
      baseSize: entry.baseSize,
      lifetimeEnergy: entry.lifetimeEnergy,
      bornOn: entry.bornOn,
      lastFedOn: entry.lastFedOn,
    })
  }
  return new Set(fish.map(entry => entry.key)).size === fish.length ? fish : null
}

export function parsePondStateShape(value: unknown): PondState | null {
  if (!isRecord(value) || value.version !== 2 || typeof value.owner !== 'string' || typeof value.seed !== 'string') return null
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0 || !isoDate(value.updatedOn)) return null
  const fish = parseFish(value.fish)
  const snapshot = parseEnergyRecord(value.snapshot)
  const lastDelta = parseEnergyRecord(value.lastDelta)
  const generator = parseGenerator(value.generator)
  if (!fish || !snapshot || !lastDelta || !generator || !isRecord(value.proof)) return null
  if (
    value.proof.algorithm !== 'sha256' ||
    !SHA256.test(String(value.proof.sourceDigest ?? '')) ||
    (value.proof.previousDigest !== null && !SHA256.test(String(value.proof.previousDigest ?? ''))) ||
    !SHA256.test(String(value.proof.digest ?? ''))
  ) return null
  for (const [date, delta] of Object.entries(lastDelta)) {
    if (snapshot[date] === undefined || delta > snapshot[date]) return null
  }
  return {
    version: 2,
    owner: value.owner,
    seed: value.seed,
    revision: Number(value.revision),
    updatedOn: value.updatedOn,
    fish,
    snapshot,
    lastDelta,
    generator,
    proof: {
      algorithm: 'sha256',
      sourceDigest: String(value.proof.sourceDigest),
      previousDigest: value.proof.previousDigest === null ? null : String(value.proof.previousDigest),
      digest: String(value.proof.digest),
    },
  }
}

function parseProvenance(value: unknown): PondProvenance | null {
  if (!isRecord(value) || value.schema !== 'koipond-state-v2' || typeof value.owner !== 'string') return null
  const generator = parseGenerator(value.generator)
  if (
    !Number.isInteger(value.revision) ||
    !isoDate(value.updatedOn) ||
    !SHA256.test(String(value.sourceDigest ?? '')) ||
    (value.previousDigest !== null && !SHA256.test(String(value.previousDigest ?? ''))) ||
    !SHA256.test(String(value.stateDigest ?? '')) ||
    !generator
  ) return null
  return {
    schema: 'koipond-state-v2',
    owner: value.owner,
    revision: Number(value.revision),
    updatedOn: value.updatedOn,
    sourceDigest: String(value.sourceDigest),
    previousDigest: value.previousDigest === null ? null : String(value.previousDigest),
    stateDigest: String(value.stateDigest),
    generator,
  }
}

function parseRelease(value: unknown): PondGenerator | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  return parseGenerator(value.action)
}

async function browserSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const sameGenerator = (left: PondGenerator | null, right: PondGenerator | null) =>
  Boolean(left && right && left.repository === right.repository && left.sha === right.sha)

export async function verifyPondArtifacts(
  stateValue: unknown,
  provenanceValue: unknown,
  releaseValue: unknown,
  now = new Date(),
): Promise<PondVerification> {
  const state = parsePondStateShape(stateValue)
  if (!state) {
    return {
      valid: false,
      state: null,
      checks: [{ id: 'state', title: 'State structure', status: 'fail', detail: 'The state file is malformed or unsupported.' }],
    }
  }

  const sourceDigest = await browserSha256({ owner: state.owner, snapshot: state.snapshot })
  const stateDigest = await browserSha256(statePayloadForHash(state))
  const stateValid = sourceDigest === state.proof.sourceDigest && stateDigest === state.proof.digest
  const provenance = parseProvenance(provenanceValue)
  const svgValid = Boolean(
    provenance &&
    provenance.owner === state.owner &&
    provenance.revision === state.revision &&
    provenance.updatedOn === state.updatedOn &&
    provenance.sourceDigest === state.proof.sourceDigest &&
    provenance.previousDigest === state.proof.previousDigest &&
    provenance.stateDigest === state.proof.digest &&
    sameGenerator(provenance.generator, state.generator),
  )
  const release = parseRelease(releaseValue)
  const generatorValid = sameGenerator(state.generator, release)
  const stateDate = new Date(`${state.updatedOn}T00:00:00Z`).getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const freshnessValid = stateDate >= today - 2 * 86_400_000 && stateDate <= today + 86_400_000
  const checks: VerificationCheck[] = [
    {
      id: 'state',
      title: 'State digest',
      status: stateValid ? 'pass' : 'fail',
      detail: stateValid ? 'The canonical state recomputes to the published SHA-256 digest.' : 'The state digest does not match its contents.',
      value: state.proof.digest,
    },
    {
      id: 'source',
      title: 'Contribution snapshot',
      status: sourceDigest === state.proof.sourceDigest ? 'pass' : 'fail',
      detail: sourceDigest === state.proof.sourceDigest ? 'The embedded contribution snapshot is bound to its source digest.' : 'The source snapshot digest is inconsistent.',
      value: state.proof.sourceDigest,
    },
    {
      id: 'svg',
      title: 'SVG provenance',
      status: svgValid ? 'pass' : 'fail',
      detail: svgValid ? 'The animated SVG names the same owner, revision, state and generator.' : 'The SVG metadata does not match the state file.',
      value: provenance?.stateDigest,
    },
    {
      id: 'generator',
      title: 'Published generator',
      status: generatorValid ? 'pass' : 'fail',
      detail: generatorValid ? 'The state was produced by the exact commit currently published in release.json.' : 'The state generator does not match the published release.',
      value: state.generator ? `${state.generator.repository}@${state.generator.sha}` : undefined,
    },
    {
      id: 'freshness',
      title: 'Recent update',
      status: freshnessValid ? 'pass' : 'fail',
      detail: freshnessValid ? `The pond snapshot is current as of ${state.updatedOn}.` : `The pond snapshot is stale or future-dated (${state.updatedOn}).`,
      value: state.updatedOn,
    },
    {
      id: 'history',
      title: state.proof.previousDigest ? 'Previous state link' : 'Genesis state',
      status: 'recorded',
      detail: state.proof.previousDigest
        ? 'The previous digest is recorded, but the previous state is not published here, so the full history is not claimed as re-verified.'
        : 'This state declares itself as the start of the chain.',
      value: state.proof.previousDigest ?? 'genesis',
    },
  ]

  return {
    valid: checks.every(check => check.status !== 'fail'),
    state,
    checks,
  }
}
