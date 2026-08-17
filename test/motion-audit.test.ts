import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText, type PondSeason } from '../src/environment'
import { auditMotion, motionAuditFailures } from '../src/motion-audit'
import { plan } from '../src/planner'

const moments: Array<{ date: string; season: PondSeason }> = [
  { date: '2026-04-16', season: 'spring' },
  { date: '2026-08-16', season: 'summer' },
  { date: '2026-10-16', season: 'autumn' },
  { date: '2026-01-15', season: 'winter' },
]

describe('motion regression', () => {
  it('keeps return paths, fish spacing and seams natural through every season by day and night', () => {
    const grid = demoGrid('motion-regression')
    for (const moment of moments) {
      for (const time of ['12:00', '00:00']) {
        const environment = deriveEnvironment(momentFromText(moment.date, time), moment.season)
        const audit = auditMotion(plan(grid, 'motion-regression', undefined, environment))
        expect(motionAuditFailures(audit)).toEqual([])
      }
    }
  })
})
