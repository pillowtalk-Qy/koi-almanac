import { describe, expect, it } from 'vitest'
import { formatUtcOffset, localTimezoneOffset, referenceLongitude } from '../src/web/time-context'

describe('browser time context', () => {
  it('uses the browser offset for a selected local wall time', () => {
    const selected = new Date(2026, 6, 15, 12, 0)
    expect(localTimezoneOffset('2026-07-15', '12:00')).toBe(-selected.getTimezoneOffset())
  })

  it('aligns the reference ecology longitude with local solar noon', () => {
    expect(referenceLongitude(480)).toBe(120)
    expect(referenceLongitude(-300)).toBe(-75)
  })

  it('formats whole-hour and fractional UTC offsets', () => {
    expect(formatUtcOffset(480)).toBe('UTC+08:00')
    expect(formatUtcOffset(-330)).toBe('UTC-05:30')
  })
})
