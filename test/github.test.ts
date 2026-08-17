import { describe, expect, it } from 'vitest'
import { gridFromDays, parsePublicContributionDays } from '../src/github'

describe('public contribution parser', () => {
  it('accepts GitHub attributes in either order and ignores unrelated cells', () => {
    const html = `
      <table>
        <td tabindex="-1" data-level="3" data-date="2026-08-14"></td>
        <td data-date="2026-08-15" aria-label="day" data-level="1"></td>
        <td data-date="not-a-date" data-level="4"></td>
        <td data-date="2026-08-16"></td>
      </table>`

    expect(parsePublicContributionDays(html)).toEqual([
      { date: '2026-08-14', count: 3, level: 3 },
      { date: '2026-08-15', count: 1, level: 1 },
    ])
  })

  it('builds a chronological grid from unsorted days', () => {
    const grid = gridFromDays([
      { date: '2026-08-16', count: 1, level: 1 },
      { date: '2026-08-15', count: 4, level: 3 },
    ])
    expect(grid.cells.map(cell => cell.date)).toEqual(['2026-08-15', '2026-08-16'])
    expect(grid.weeks).toBe(2)
  })

  it('refuses an empty calendar with a clear error', () => {
    expect(() => gridFromDays([])).toThrow('without days')
  })
})
