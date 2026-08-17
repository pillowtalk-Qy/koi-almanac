import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('README pond demo', () => {
  it('embeds native animated SVGs directly for light and dark mode', () => {
    const readme = readFileSync('README.md', 'utf8')

    expect(readme).toContain('srcset="assets/demo-dark.svg"')
    expect(readme).toContain('src="assets/demo-light.svg"')
    expect(readme).not.toContain('demo-cycle.svg')

    for (const file of ['assets/demo-light.svg', 'assets/demo-dark.svg']) {
      const svg = readFileSync(file, 'utf8')
      expect(svg).toMatch(/^<svg /)
      expect(svg).toContain('@keyframes fp0')
      expect(svg).toContain('.pk,.rp{')
      expect(svg).not.toContain('data:image/svg+xml;base64,')
    }
  })
})
