import { describe, expect, it } from 'vitest'
import { deriveEnvironment, momentAtTimezone, momentFromText } from '../src/environment'

describe('pond environment', () => {
  it('tracks the Hong Kong solar day', () => {
    const noon = deriveEnvironment(momentFromText('2026-06-21', '12:00'))
    const midnight = deriveEnvironment(momentFromText('2026-06-21', '00:00'))
    expect(noon.phase).toBe('day')
    expect(noon.daylight).toBe(1)
    expect(midnight.phase).toBe('night')
    expect(midnight.daylight).toBe(0)
    expect(midnight.nightDepth).toBeGreaterThan(0.95)
    expect(midnight.lotusOpenness).toBeLessThan(0.2)
    expect(noon.lotusOpenness).toBeGreaterThan(0.95)
  })

  it('blends seasons continuously and reverses them by hemisphere', () => {
    const north = deriveEnvironment(momentFromText('2026-07-15', '12:00', 480, 35))
    const south = deriveEnvironment(momentFromText('2026-07-15', '12:00', 600, -35))
    expect(north.season).toBe('summer')
    expect(south.season).toBe('winter')
    expect(north.seasonWeights.summer).toBeGreaterThan(0.98)
    expect(Object.values(north.seasonWeights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 2)
  })

  it('uses an explicit timezone without depending on the runner locale', () => {
    const moment = momentAtTimezone(new Date('2026-08-16T01:30:00Z'), 480, 22.3193)
    expect(moment.minuteOfDay).toBe(9 * 60 + 30)
    expect(moment.day).toBe(16)
  })

  it('supports deterministic season previews', () => {
    const environment = deriveEnvironment(momentFromText('2026-08-16', '12:00'), 'winter')
    expect(environment.season).toBe('winter')
    expect(environment.seasonWeights.winter).toBe(1)
    expect(environment.iceCoverage).toBe(1)
    expect(environment.mapleDrift).toBe(0)
  })

  it('moves directional light across the pond during the day', () => {
    const morning = deriveEnvironment(momentFromText('2026-08-16', '08:00'))
    const noon = deriveEnvironment(momentFromText('2026-08-16', '12:00'))
    const afternoon = deriveEnvironment(momentFromText('2026-08-16', '16:00'))
    expect(morning.sunDirection).toBeLessThan(0)
    expect(afternoon.sunDirection).toBeGreaterThan(0)
    expect(morning.sunStrength).toBeGreaterThan(0)
    expect(afternoon.sunStrength).toBeGreaterThan(0)
    expect(morning.goldenLight).toBeGreaterThan(noon.goldenLight)
    expect(afternoon.goldenLight).toBeGreaterThan(noon.goldenLight)
  })

  it('derives a reproducible lunar cycle without an external service', () => {
    const newMoon = deriveEnvironment(momentFromText('2000-01-06', '18:14', 0, 0, 0))
    const fullMoon = deriveEnvironment(momentFromText('2000-01-21', '00:00', 0, 0, 0))
    expect(Math.min(newMoon.moonPhase, 1 - newMoon.moonPhase)).toBeLessThan(0.002)
    expect(newMoon.moonIllumination).toBeLessThan(0.001)
    expect(fullMoon.moonIllumination).toBeGreaterThan(0.99)
    expect(fullMoon.moonStrength).toBeGreaterThan(0.95)
  })

  it('changes a continuous pond current over time and location', () => {
    const first = deriveEnvironment(momentFromText('2026-08-16', '00:00', 0, 0, 0))
    const oneMinuteLater = deriveEnvironment(momentFromText('2026-08-16', '00:01', 0, 0, 0))
    const reversed = deriveEnvironment(momentFromText('2026-08-22', '00:00', 0, 0, 0))
    expect(first.currentDirection).toBeGreaterThan(0)
    expect(reversed.currentDirection).toBeLessThan(0)
    expect(Math.abs(first.currentDirection - oneMinuteLater.currentDirection)).toBeLessThan(0.01)
    expect(first.currentStrength).toBeGreaterThanOrEqual(0.32)
    expect(first.currentStrength).toBeLessThanOrEqual(1)
  })
})
