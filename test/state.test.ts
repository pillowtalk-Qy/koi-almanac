import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { cellEnergy } from '../src/ecology'
import { plan } from '../src/planner'
import {
  POND_STATE_VERSION,
  canonicalJSON,
  finalizePondState,
  parsePondState,
  preparePondState,
  serializePondState,
  verifyPondState,
} from '../src/state'

const owner = 'pillowtalk-Qy'
const seed = owner
const generator = {
  repository: 'pillowtalk-Qy/koi-almanac',
  sha: '1234567890abcdef1234567890abcdef12345678',
}

describe('persistent pond state', () => {
  it('bootstraps stable fish identities and conserves lifetime energy', () => {
    const grid = demoGrid('state-first')
    const prepared = preparePondState(grid, owner, seed)
    const state = finalizePondState(prepared, plan(grid, seed, prepared.identities))
    const expectedEnergy = grid.cells.reduce((sum, cell) => sum + cellEnergy(cell), 0)

    expect(state.version).toBe(POND_STATE_VERSION)
    expect(state.proof.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(state.proof.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(state.proof.previousDigest).toBeNull()
    expect(new Set(state.fish.map(fish => fish.key)).size).toBe(state.fish.length)
    expect(state.fish.reduce((sum, fish) => sum + fish.lifetimeEnergy, 0)).toBe(expectedEnergy)
    expect(parsePondState(JSON.parse(serializePondState(state)), owner, seed)).toEqual(state)
  })

  it('does not feed the same public calendar twice', () => {
    const grid = demoGrid('state-repeat')
    const first = preparePondState(grid, owner, seed)
    const state = finalizePondState(first, plan(grid, seed, first.identities))
    const energy = state.fish.map(fish => fish.lifetimeEnergy)
    const second = preparePondState(grid, owner, seed, state)
    const repeated = finalizePondState(second, plan(grid, seed, second.identities))

    expect(second.deltaByCell.size).toBe(0)
    expect(repeated.revision).toBe(state.revision)
    expect(repeated.proof.digest).toBe(state.proof.digest)
    expect(repeated.lastDelta).toEqual(state.lastDelta)
    expect(repeated.fish.map(fish => fish.lifetimeEnergy)).toEqual(energy)
    expect(repeated.fish.map(fish => fish.key)).toEqual(state.fish.map(fish => fish.key))
  })

  it('credits only newly visible contribution energy', () => {
    const grid = demoGrid('state-delta')
    const first = preparePondState(grid, owner, seed)
    const state = finalizePondState(first, plan(grid, seed, first.identities))
    const previousTotal = state.fish.reduce((sum, fish) => sum + fish.lifetimeEnergy, 0)
    const changedIndex = grid.cells.findIndex(cell => cell.level < 4)
    const changed = {
      ...grid,
      cells: grid.cells.map((cell, index) =>
        index === changedIndex
          ? { ...cell, count: 9, level: Math.min(4, cell.level + 1) as 0 | 1 | 2 | 3 | 4 }
          : cell,
      ),
    }
    const oldEnergy = cellEnergy(grid.cells[changedIndex])
    const newEnergy = cellEnergy(changed.cells[changedIndex])
    const prepared = preparePondState(changed, owner, seed, state)
    const next = finalizePondState(prepared, plan(changed, seed, prepared.identities))

    expect(prepared.deltaByCell.size).toBe(newEnergy > oldEnergy ? 1 : 0)
    expect(next.fish.reduce((sum, fish) => sum + fish.lifetimeEnergy, 0)).toBe(previousTotal + newEnergy - oldEnergy)
    expect(next.fish.map(fish => fish.key)).toEqual(state.fish.map(fish => fish.key))
    expect(next.proof.previousDigest).toBe(state.proof.digest)
    expect(next.proof.digest).not.toBe(state.proof.digest)
    expect(Object.values(next.lastDelta)).toEqual([newEnergy - oldEnergy])
  })

  it('rejects incompatible or malformed state instead of partially trusting it', () => {
    expect(parsePondState({ version: POND_STATE_VERSION + 1 }, owner, seed)).toBeNull()
    expect(
      parsePondState(
        { version: POND_STATE_VERSION, owner, seed, revision: 1, updatedOn: '', fish: [], snapshot: { nope: 99 } },
        owner,
        seed,
      ),
    ).toBeNull()

    const grid = demoGrid('state-invalid')
    const prepared = preparePondState(grid, owner, seed)
    const valid = finalizePondState(prepared, plan(grid, seed, prepared.identities))
    expect(parsePondState({ ...valid, fish: valid.fish.map(fish => ({ ...fish, baseSize: Infinity })) }, owner, seed)).toBeNull()
    expect(parsePondState({ ...valid, fish: [valid.fish[0], valid.fish[0]] }, owner, seed)).toBeNull()
    expect(
      verifyPondState({
        ...valid,
        fish: valid.fish.map((fish, index) => (index === 0 ? { ...fish, lifetimeEnergy: fish.lifetimeEnergy + 1 } : fish)),
      }),
    ).toBeNull()
  })

  it('migrates v1 state without losing fish history', () => {
    const grid = demoGrid('state-migration')
    const prepared = preparePondState(grid, owner, seed)
    const current = finalizePondState(prepared, plan(grid, seed, prepared.identities))
    const legacy = {
      version: 1,
      owner: current.owner,
      seed: current.seed,
      revision: current.revision,
      updatedOn: current.updatedOn,
      fish: current.fish,
      snapshot: current.snapshot,
    }
    const migrated = parsePondState(legacy, owner, seed)
    expect(migrated?.version).toBe(2)
    expect(migrated?.fish).toEqual(current.fish)
    expect(migrated?.lastDelta).toEqual({})
    expect(migrated?.generator).toBeNull()
    expect(verifyPondState(migrated)).toEqual(migrated)
  })

  it('cryptographically binds the exact generator and links generator upgrades', () => {
    const grid = demoGrid('state-generator')
    const prepared = preparePondState(grid, owner, seed, null, generator)
    const first = finalizePondState(prepared, plan(grid, seed, prepared.identities))

    expect(first.generator).toEqual(generator)
    expect(verifyPondState({ ...first, generator: { ...generator, sha: 'a'.repeat(40) } })).toBeNull()

    const upgradedGenerator = { ...generator, sha: 'abcdef1234567890abcdef1234567890abcdef12' }
    const upgraded = preparePondState(grid, owner, seed, first, upgradedGenerator).state
    expect(upgraded.revision).toBe(first.revision + 1)
    expect(upgraded.proof.previousDigest).toBe(first.proof.digest)
    expect(upgraded.proof.digest).not.toBe(first.proof.digest)
    expect(upgraded.lastDelta).toEqual({})
    expect(upgraded.generator).toEqual(upgradedGenerator)
  })

  it('canonicalizes object keys before hashing', () => {
    expect(canonicalJSON({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}')
  })
})
