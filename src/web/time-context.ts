export const HONG_KONG = {
  timezoneOffsetMinutes: 480,
  latitude: 22.3193,
  longitude: 114.1694,
} as const

export type TimeBasis = 'local' | 'hong-kong'

export interface PondCoordinates {
  latitude: number
  longitude: number
}

const parseLocalDate = (dateText: string, timeText: string) => {
  const [year, month, day] = dateText.split('-').map(Number)
  const [hour, minute] = timeText.split(':').map(Number)
  return new Date(year, month - 1, day, hour, minute)
}

export function localTimezoneOffset(dateText: string, timeText: string): number {
  const localDate = parseLocalDate(dateText, timeText)
  const offset = -localDate.getTimezoneOffset()
  return Number.isFinite(offset) ? offset : -new Date().getTimezoneOffset()
}

export function localTimezoneName(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local'
}

export function referenceLongitude(timezoneOffsetMinutes: number): number {
  return Math.max(-180, Math.min(180, timezoneOffsetMinutes / 4))
}

export function formatUtcOffset(timezoneOffsetMinutes: number): string {
  const sign = timezoneOffsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(timezoneOffsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
