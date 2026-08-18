import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { plan } from '../src/planner'
import { finalizePondState, preparePondState, provenanceFor } from '../src/state'
import { parsePondStateShape, verifyPondArtifacts } from '../src/web/state-verifier'

const generator = {
  repository: 'pillowtalk-Qy/koi-almanac',
  sha: '1234567890abcdef1234567890abcdef12345678',
}

function fixture() {
  const grid = demoGrid('browser-verifier')
  const prepared = preparePondState(grid, 'pillowtalk-Qy', 'pillowtalk-Qy', null, generator)
  const state = finalizePondState(prepared, plan(grid, 'pillowtalk-Qy', prepared.identities))
  const release = { schemaVersion: 1, action: generator }
  return { state, provenance: provenanceFor(state), release }
}

describe('browser-local pond verifier', () => {
  it('recomputes state and source hashes and binds SVG provenance to the release', async () => {
    const { state, provenance, release } = fixture()
    const result = await verifyPondArtifacts(state, provenance, release, new Date(`${state.updatedOn}T12:00:00Z`))
    expect(result.valid).toBe(true)
    expect(result.checks.map(check => check.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'recorded'])
    expect(result.checks.at(-1)?.value).toBe('genesis')
  })

  it('labels a previous digest as recorded rather than fully re-verified', async () => {
    const { state } = fixture()
    const nextGenerator = { ...generator, sha: 'b'.repeat(40) }
    const grid = demoGrid('browser-verifier')
    const prepared = preparePondState(grid, state.owner, state.seed, state, nextGenerator)
    const next = finalizePondState(prepared, plan(grid, state.seed, prepared.identities))
    const result = await verifyPondArtifacts(
      next,
      provenanceFor(next),
      { schemaVersion: 1, action: nextGenerator },
      new Date(`${next.updatedOn}T12:00:00Z`),
    )
    expect(result.valid).toBe(true)
    expect(result.checks.at(-1)?.status).toBe('recorded')
    expect(result.checks.at(-1)?.detail).toMatch(/not claimed as re-verified/)
  })

  it('rejects tampered state, mismatched SVG metadata and unpublished generators', async () => {
    const { state, provenance, release } = fixture()
    const now = new Date(`${state.updatedOn}T12:00:00Z`)
    const tampered = { ...state, fish: state.fish.map((entry, index) => index === 0 ? { ...entry, lifetimeEnergy: entry.lifetimeEnergy + 1 } : entry) }
    expect((await verifyPondArtifacts(tampered, provenance, release, now)).valid).toBe(false)
    expect((await verifyPondArtifacts(state, { ...provenance, revision: provenance.revision + 1 }, release, now)).valid).toBe(false)
    expect((await verifyPondArtifacts(state, provenance, { ...release, action: { ...generator, sha: 'a'.repeat(40) } }, now)).valid).toBe(false)
  })

  it('rejects malformed state before hashing it', () => {
    const { state } = fixture()
    expect(parsePondStateShape({ ...state, snapshot: { nope: 9 } })).toBeNull()
    expect(parsePondStateShape({ ...state, generator: null })).toBeNull()
  })
})
