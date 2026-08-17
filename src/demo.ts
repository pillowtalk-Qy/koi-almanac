import { rng } from './prng'
import { DAY_MS } from './util'
import type { Cell, Grid } from './types'

function levelOf(count: number): Cell['level'] {
  if (count === 0) return 0
  if (count < 2) return 1
  if (count < 4) return 2
  if (count < 8) return 3
  return 4
}

export function demoGrid(seed: string, weeks = 53): Grid {
  const r = rng('demo:' + seed)
  const cells: Cell[] = []
  const start = Date.UTC(2025, 6, 16)

  const streakStart = 40 + Math.floor(r() * 30)
  const streakLen = 36
  const gapStart = 230 + Math.floor(r() * 40)
  const gapLen = 26

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d
      let count = 0
      const inStreak = idx >= streakStart && idx < streakStart + streakLen
      const inGap = idx >= gapStart && idx < gapStart + gapLen
      if (!inGap) {
        const isWeekday = d >= 1 && d <= 5
        const base = isWeekday ? 0.6 : 0.28
        if (inStreak) count = 1 + Math.floor(r() * 9)
        else if (r() < base) count = r() < 0.16 ? 6 + Math.floor(r() * 8) : 1 + Math.floor(r() * 5)
      }
      const date = new Date(start + idx * DAY_MS).toISOString().slice(0, 10)
      cells.push({ week: w, day: d, date, count, level: levelOf(count) })
    }
  }
  return { weeks, cells }
}
