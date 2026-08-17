import { describe, expect, it } from 'vitest'
import {
  renderReadmeShowcase,
  SHOWCASE_LOOP_SECONDS,
  SHOWCASE_TRANSITION_SECONDS,
  showcaseScenes,
} from '../src/showcase'

describe('README seasonal showcase', () => {
  it('contains every season and phase as a moving embedded pond', () => {
    const svg = renderReadmeShowcase('showcase-test')
    const embedded = [...svg.matchAll(/href="data:image\/svg\+xml;base64,([^"]+)"/g)]

    expect(SHOWCASE_LOOP_SECONDS).toBe(14)
    expect(SHOWCASE_TRANSITION_SECONDS).toBe(1.2)
    expect(showcaseScenes()).toHaveLength(4)
    expect(embedded).toHaveLength(4)
    expect(svg.match(/data-showcase-season=/g)).toHaveLength(4)
    expect(svg.match(/data-showcase-phase=/g)).toHaveLength(4)
    expect(svg).toContain('@media (prefers-reduced-motion:reduce)')
    expect(svg).toContain('cubic-bezier(0.45,0,0.55,1)')

    const decoded = embedded.map(match => Buffer.from(match[1], 'base64').toString('utf8'))
    for (const season of ['spring', 'summer', 'autumn', 'winter']) {
      expect(decoded.some(scene => scene.includes(`"season":"${season}"`))).toBe(true)
    }
    expect(showcaseScenes().map(scene => scene.phase)).toEqual(['day', 'night', 'day', 'night'])
    expect(decoded.every(scene => scene.includes('<svg'))).toBe(true)

    const fishTimelines = decoded.map(scene => {
      const start = scene.indexOf('@keyframes fp0')
      expect(start).toBeGreaterThan(-1)
      return scene.slice(start, scene.indexOf('</style>'))
    })
    expect(fishTimelines.every(timeline => timeline.length > 100)).toBe(true)
    expect(new Set(fishTimelines).size).toBe(1)
  })
})
