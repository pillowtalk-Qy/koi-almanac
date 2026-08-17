import { describe, expect, it } from 'vitest'
import { renderReadmeShowcase, SHOWCASE_LOOP_SECONDS, showcaseScenes } from '../src/showcase'

describe('README seasonal showcase', () => {
  it('contains every season and phase as a moving embedded pond', () => {
    const svg = renderReadmeShowcase('showcase-test')
    const embedded = [...svg.matchAll(/href="data:image\/svg\+xml;base64,([^"]+)"/g)]

    expect(SHOWCASE_LOOP_SECONDS).toBe(32)
    expect(showcaseScenes()).toHaveLength(8)
    expect(embedded).toHaveLength(8)
    expect(svg.match(/data-showcase-season=/g)).toHaveLength(8)
    expect(svg.match(/data-showcase-phase=/g)).toHaveLength(8)
    expect(svg).toContain('@media (prefers-reduced-motion:reduce)')

    const decoded = embedded.map(match => Buffer.from(match[1], 'base64').toString('utf8'))
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      expect(decoded.some(scene => scene.includes(`"season":"${season}"`))).toBe(true)
    }
    expect(decoded.every(scene => scene.includes('<svg'))).toBe(true)
  })
})
