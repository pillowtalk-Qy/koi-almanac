import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('README pond demo', () => {
  it('embeds one native animated SVG containing every season and phase', () => {
    const readme = readFileSync('README.md', 'utf8')
    const svg = readFileSync('assets/demo-almanac.svg', 'utf8')

    expect(readme).toContain('src="assets/demo-almanac.svg"')
    expect(readme).toContain('24-second accelerated tour')
    expect(readme).toContain('https://pillowtalk-qy.github.io/koi-almanac/')
    expect(readme).not.toContain('demo-cycle.svg')
    expect(svg).toMatch(/^<svg /)
    expect(svg.match(/data-readme-season=/g)).toHaveLength(8)
    expect(svg.match(/data-readme-phase="day"/g)).toHaveLength(4)
    expect(svg.match(/data-readme-phase="night"/g)).toHaveLength(4)
    expect(svg).toContain('@keyframes rd0-fp0')
    expect(svg).toContain('url(#rd0-fx)')
    expect(svg).not.toContain('data:image/svg+xml;base64,')
    expect(svg).not.toContain('<image')
  })
})
