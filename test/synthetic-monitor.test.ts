import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText } from '../src/environment'
import { plan } from '../src/planner'
import { finalizePondState, preparePondState, provenanceFor } from '../src/state'
import {
  validateContributions,
  validateExplorer,
  validateHealth,
  validateProductionArtifacts,
} from '../src/synthetic-monitor'

const generator = {
  repository: 'pillowtalk-Qy/koi-almanac',
  sha: '1234567890abcdef1234567890abcdef12345678',
}

describe('synthetic production monitor contracts', () => {
  it('validates the privacy health declaration and a fresh public calendar', () => {
    validateHealth({ ok: true, source: 'github.com', logging: 'disabled', snapshot: 'global-kv' })
    expect(() => validateHealth({ ok: true, source: 'github.com', logging: 'enabled' })).toThrow(/logging/)

    const now = new Date('2026-08-17T12:00:00Z')
    const contributions = Array.from({ length: 365 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 7, 18 + index)).toISOString().slice(0, 10)
      return { date, count: index % 7, level: index % 5 }
    })
    expect(validateContributions({ source: 'github.com/public-contribution-calendar', contributions }, now)).toBe(365)
  })

  it('binds production SVG metadata, state and release identity together', () => {
    const grid = demoGrid('synthetic-monitor')
    const prepared = preparePondState(grid, 'pillowtalk-Qy', 'pillowtalk-Qy', null, generator)
    const state = finalizePondState(prepared, plan(grid, 'pillowtalk-Qy', prepared.identities))
    const metadata = JSON.stringify(provenanceFor(state)).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    const now = new Date(`${state.updatedOn}T04:00:00Z`)
    const environment = deriveEnvironment(momentFromText(state.updatedOn, '12:00'))
    const environmentMetadata = JSON.stringify(environment).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 737 180">` +
      `<metadata id="koipond-provenance">${metadata}</metadata>` +
      `<metadata id="koipond-environment">${environmentMetadata}</metadata>${' '.repeat(50_000)}</svg>`

    expect(validateProductionArtifacts(svg, state, generator, 'pillowtalk-Qy', 480, now)).toEqual(state)
    expect(() => validateProductionArtifacts(svg, state, { ...generator, sha: 'a'.repeat(40) }, 'pillowtalk-Qy', 480, now))
      .toThrow(/released generator/)
  })

  it('detects an incomplete explorer deployment', () => {
    const html = '<title>Koi Almanac:</title><form id="form"><input id="year-timeline"><input id="day-timeline">' +
      '<div id="pond"></div><script src="demo.js" defer></script>'
    const javascript = `koi-almanac-contributions.intentflow-inspector.workers.dev${' '.repeat(50_000)}`
    validateExplorer(html, javascript)
    expect(() => validateExplorer(html, 'small')).toThrow(/small/)
  })
})
