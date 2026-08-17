import { describe, expect, it } from 'vitest'
import { environmentFromParams } from '../src/environment-query'

describe('environment query options', () => {
  it('leaves legacy light and dark outputs untouched', () => {
    expect(environmentFromParams(new URLSearchParams('theme=dark'))).toBeUndefined()
  })

  it('derives an automatic Hong Kong environment from the generation time', () => {
    const environment = environmentFromParams(
      new URLSearchParams('environment=auto'),
      new Date('2026-08-16T04:00:00Z'),
    )
    expect(environment).toMatchObject({ date: '2026-08-16', minuteOfDay: 720, phase: 'day' })
  })

  it('accepts reproducible date, time, location and season overrides', () => {
    const environment = environmentFromParams(
      new URLSearchParams('environment=auto&date=2026-12-21&time=23:30&timezone=480&latitude=22.3193&season=winter'),
    )
    expect(environment).toMatchObject({
      date: '2026-12-21',
      minuteOfDay: 1410,
      phase: 'night',
      season: 'winter',
    })
  })

  it('rejects invalid overrides instead of silently producing a wrong pond', () => {
    expect(() => environmentFromParams(new URLSearchParams('environment=auto&season=monsoon'))).toThrow(
      'Invalid season',
    )
  })
})
