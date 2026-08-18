import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText } from '../src/environment'
import { plan } from '../src/planner'
import { finalizePondState, preparePondState, provenanceFor } from '../src/state'
import {
  validateContributions,
  validateExplorer,
  validateHealth,
  validateProfileDelivery,
  validateProfilePresentation,
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
      `<metadata id="koipond-environment">${environmentMetadata}</metadata>` +
      `<style>.fish{animation-iteration-count:infinite}@keyframes fp0{from{opacity:1}to{opacity:1}}</style>` +
      `${' '.repeat(50_000)}</svg>`

    expect(validateProductionArtifacts(svg, state, generator, 'pillowtalk-Qy', 480, now)).toEqual(state)
    expect(() => validateProductionArtifacts(svg, state, { ...generator, sha: 'a'.repeat(40) }, 'pillowtalk-Qy', 480, now))
      .toThrow(/released generator/)
  })

  it('detects an incomplete explorer deployment', () => {
    const html = '<title>Koi Almanac:</title><form id="form"><input id="year-timeline"><input id="day-timeline">' +
      '<div id="pond"></div><script src="demo.js" defer></script>'
    const javascript = `koi-almanac-contributions.intentflow-inspector.workers.dev${' '.repeat(50_000)}`
    const workerJavascript = `koipond-environment${' '.repeat(50_000)}`
    validateExplorer(html, javascript, workerJavascript)
    expect(() => validateExplorer(html, 'small', workerJavascript)).toThrow(/small/)
  })

  it('binds the rendered GitHub profile to a secure cached SVG delivery', () => {
    const svgUrl = 'https://raw.githubusercontent.com/pillowtalk-Qy/pillowtalk-Qy/output/koi-almanac.svg'
    const explorer = 'https://pillowtalk-qy.github.io/koi-almanac/?user=pillowtalk-Qy'
    const image = `<a href="${explorer}"><img alt="Qy's Koi Almanac" src="${svgUrl}"></a>`
    validateProfilePresentation(`<main>${image}</main>`, image, svgUrl, explorer)
    expect(() => validateProfilePresentation('<main></main>', image, svgUrl, explorer)).toThrow(/Rendered/)

    validateProfileDelivery(new Headers({
      'content-type': 'image/svg+xml',
      'cache-control': 'max-age=300',
      'x-content-type-options': 'nosniff',
      'access-control-allow-origin': '*',
      'content-security-policy': "default-src 'none'; sandbox",
    }))
  })
})
