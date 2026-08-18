import type { PondState } from './state'

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

export function statePayloadForHash(state: PondState): unknown {
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
