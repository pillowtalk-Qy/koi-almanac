import {
  deriveEnvironment,
  momentAtTimezone,
  momentFromText,
  type PondEnvironment,
  type PondSeason,
} from './environment'

const SEASONS = new Set<PondSeason>(['spring', 'summer', 'autumn', 'winter'])

const numericParam = (params: URLSearchParams, name: string, fallback: number) => {
  const text = params.get(name)
  if (text === null || text === '') return fallback
  const value = Number(text)
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}: ${text}`)
  return value
}

const dateText = (moment: ReturnType<typeof momentAtTimezone>) =>
  `${moment.year}-${String(moment.month).padStart(2, '0')}-${String(moment.day).padStart(2, '0')}`

const timeText = (moment: ReturnType<typeof momentAtTimezone>) =>
  `${String(Math.floor(moment.minuteOfDay / 60)).padStart(2, '0')}:${String(moment.minuteOfDay % 60).padStart(2, '0')}`

export function environmentFromParams(
  params: URLSearchParams,
  now = new Date(),
): PondEnvironment | undefined {
  if (params.get('environment') !== 'auto') return undefined

  const timezoneOffset = numericParam(params, 'timezone', 480)
  const latitude = numericParam(params, 'latitude', 22.3193)
  const longitude = numericParam(params, 'longitude', 114.1694)
  const current = momentAtTimezone(now, timezoneOffset, latitude, longitude)
  const seasonText = params.get('season')
  if (seasonText && !SEASONS.has(seasonText as PondSeason)) {
    throw new Error(`Invalid season: ${seasonText}`)
  }

  const moment = momentFromText(
    params.get('date') ?? dateText(current),
    params.get('time') ?? timeText(current),
    timezoneOffset,
    latitude,
    longitude,
  )
  return deriveEnvironment(moment, seasonText as PondSeason | undefined)
}
