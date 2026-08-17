import { f3 } from './util'

export type PondSeason = 'spring' | 'summer' | 'autumn' | 'winter'
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night'

export interface PondMoment {
  year: number
  month: number
  day: number
  minuteOfDay: number
  latitude: number
  longitude: number
  timezoneOffsetMinutes: number
}

export interface PondEnvironment {
  date: string
  minuteOfDay: number
  timezoneOffsetMinutes: number
  latitude: number
  longitude: number
  dayOfYear: number
  solarAltitude: number
  sunDirection: number
  sunStrength: number
  daylight: number
  twilight: number
  goldenLight: number
  nightDepth: number
  moonPhase: number
  moonIllumination: number
  moonAltitude: number
  moonDirection: number
  moonStrength: number
  currentDirection: number
  currentStrength: number
  phase: DayPhase
  season: PondSeason
  seasonWeights: Record<PondSeason, number>
  waterTemperature: number
  activityRate: number
  plantCoverage: number
  bloom: number
  summerBloom: number
  lotusOpenness: number
  mapleDrift: number
  iceCoverage: number
  surfaceActivity: number
  winterStillness: number
}

const DAY_MS = 86_400_000
const JULIAN_UNIX_EPOCH = 2_440_587.5
const KNOWN_NEW_MOON_JD = 2_451_550.25972
const SYNODIC_MONTH_DAYS = 29.53058867
const SEASONS: PondSeason[] = ['spring', 'summer', 'autumn', 'winter']
const SEASON_CENTERS: Record<PondSeason, number> = {
  spring: 0.285,
  summer: 0.535,
  autumn: 0.785,
  winter: 0.035,
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = clamp((value - edge0) / (edge1 - edge0))
  return amount * amount * (3 - 2 * amount)
}

const circularDistance = (left: number, right: number) => {
  const distance = Math.abs(left - right) % 1
  return Math.min(distance, 1 - distance)
}

const positiveModulo = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

const signedCircularMinutes = (value: number) => positiveModulo(value + 720, 1440) - 720

const daysInYear = (year: number) => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS

export function dayOfYear(moment: Pick<PondMoment, 'year' | 'month' | 'day'>): number {
  return Math.floor((Date.UTC(moment.year, moment.month - 1, moment.day) - Date.UTC(moment.year, 0, 1)) / DAY_MS) + 1
}

export function momentAtTimezone(
  date: Date,
  timezoneOffsetMinutes = 480,
  latitude = 22.3193,
  longitude = 114.1694,
): PondMoment {
  const shifted = new Date(date.getTime() + timezoneOffsetMinutes * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    latitude,
    longitude,
    timezoneOffsetMinutes,
  }
}

export function momentFromText(
  dateText: string,
  timeText: string,
  timezoneOffsetMinutes = 480,
  latitude = 22.3193,
  longitude = 114.1694,
): PondMoment {
  const [year, month, day] = dateText.split('-').map(Number)
  const [hour, minute] = timeText.split(':').map(Number)
  if (
    ![year, month, day, hour, minute, timezoneOffsetMinutes, latitude, longitude].every(Number.isFinite) ||
    month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
    timezoneOffsetMinutes < -720 || timezoneOffsetMinutes > 840
  ) {
    throw new Error('Invalid pond date, time, timezone or location')
  }
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new Error('Invalid pond date, time, timezone or location')
  }
  return { year, month, day, minuteOfDay: hour * 60 + minute, latitude, longitude, timezoneOffsetMinutes }
}

function seasonWeights(yearProgress: number, latitude: number, override?: PondSeason) {
  if (override) {
    return Object.fromEntries(SEASONS.map(season => [season, season === override ? 1 : 0])) as Record<PondSeason, number>
  }
  const progress = latitude < 0 ? (yearProgress + 0.5) % 1 : yearProgress
  const raw = Object.fromEntries(SEASONS.map(season => {
    const distance = circularDistance(progress, SEASON_CENTERS[season])
    return [season, Math.exp(-0.5 * (distance / 0.075) ** 2)]
  })) as Record<PondSeason, number>
  const total = SEASONS.reduce((sum, season) => sum + raw[season], 0)
  return Object.fromEntries(SEASONS.map(season => [season, raw[season] / total])) as Record<PondSeason, number>
}

export function deriveEnvironment(moment: PondMoment, seasonOverride?: PondSeason): PondEnvironment {
  const ordinal = dayOfYear(moment)
  const yearProgress = (ordinal - 0.5) / daysInYear(moment.year)
  const latitude = (moment.latitude * Math.PI) / 180
  const hour = moment.minuteOfDay / 60
  const fractionalYear = (2 * Math.PI / 365) * (ordinal - 1 + (hour - 12) / 24)
  const equationOfTime = 229.18 * (
    0.000075 +
    0.001868 * Math.cos(fractionalYear) -
    0.032077 * Math.sin(fractionalYear) -
    0.014615 * Math.cos(2 * fractionalYear) -
    0.040849 * Math.sin(2 * fractionalYear)
  )
  const declination =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(2 * fractionalYear) +
    0.000907 * Math.sin(2 * fractionalYear) -
    0.002697 * Math.cos(3 * fractionalYear) +
    0.00148 * Math.sin(3 * fractionalYear)
  const solarMinutes = moment.minuteOfDay + equationOfTime + 4 * moment.longitude - moment.timezoneOffsetMinutes
  const hourAngle = ((solarMinutes / 4 - 180) * Math.PI) / 180
  const solarAltitude = Math.asin(
    Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  ) * 180 / Math.PI
  const sunDirection = clamp(hourAngle / (Math.PI / 2), -1, 1)
  const sunStrength = smoothstep(4, 66, solarAltitude)
  const daylight = smoothstep(-6, 8, solarAltitude)
  const twilight = smoothstep(-18, -4, solarAltitude) * (1 - smoothstep(-4, 8, solarAltitude))
  const goldenLight = smoothstep(-8, 5, solarAltitude) * (1 - smoothstep(12, 44, solarAltitude))
  const nightDepth = 1 - smoothstep(-24, -8, solarAltitude)
  const utcTimestamp =
    Date.UTC(moment.year, moment.month - 1, moment.day) -
    moment.timezoneOffsetMinutes * 60_000 +
    moment.minuteOfDay * 60_000
  const julianDay = utcTimestamp / DAY_MS + JULIAN_UNIX_EPOCH
  const moonPhase = positiveModulo((julianDay - KNOWN_NEW_MOON_JD) / SYNODIC_MONTH_DAYS, 1)
  const moonIllumination = (1 - Math.cos(moonPhase * Math.PI * 2)) / 2
  const moonTransitMinute = positiveModulo(720 + moonPhase * 1440, 1440)
  const moonMinuteFromTransit = signedCircularMinutes(moment.minuteOfDay - moonTransitMinute)
  const moonAltitude = Math.cos((moonMinuteFromTransit / 720) * Math.PI)
  const moonDirection = clamp(moonMinuteFromTransit / 360, -1, 1)
  const moonStrength = moonIllumination * smoothstep(-0.08, 0.42, moonAltitude) * nightDepth
  const continuousDay = (utcTimestamp - Date.UTC(2000, 0, 1)) / DAY_MS
  const longitudePhase = (moment.longitude * Math.PI) / 180
  const latitudePhase = (moment.latitude * Math.PI) / 180
  const currentDirection = Math.sin(
    (continuousDay * Math.PI * 2) / 11.7 + longitudePhase * 0.6 + latitudePhase * 0.4,
  )
  const currentStrength = 0.32 + 0.68 * (
    0.5 + 0.5 * Math.sin((continuousDay * Math.PI * 2) / 6.3 + longitudePhase * 1.3 - latitudePhase * 0.5)
  )
  const lotusOpenness = 0.12 + smoothstep(-3, 20, solarAltitude) * 0.88
  const weights = seasonWeights(yearProgress, moment.latitude, seasonOverride)
  const season = SEASONS.reduce((best, candidate) => weights[candidate] > weights[best] ? candidate : best, 'spring')
  const waterTemperature = weights.spring * 17 + weights.summer * 27 + weights.autumn * 19 + weights.winter * 9
  const seasonalActivity = weights.spring * 1 + weights.summer * 1.08 + weights.autumn * 0.92 + weights.winter * 0.7
  const activityRate = seasonalActivity * (0.82 + daylight * 0.18)
  const plantCoverage = weights.spring + weights.summer + weights.autumn * 0.58 + weights.winter * 0.22
  const bloom = weights.spring + weights.summer
  const surfaceActivity = weights.spring + weights.summer * 1.08 + weights.autumn * 0.7 + weights.winter * 0.34
  const phase: DayPhase = solarAltitude >= 4
    ? 'day'
    : solarAltitude <= -12
      ? 'night'
      : moment.minuteOfDay < 720 ? 'dawn' : 'dusk'

  return {
    date: `${moment.year}-${String(moment.month).padStart(2, '0')}-${String(moment.day).padStart(2, '0')}`,
    minuteOfDay: moment.minuteOfDay,
    timezoneOffsetMinutes: moment.timezoneOffsetMinutes,
    latitude: f3(moment.latitude),
    longitude: f3(moment.longitude),
    dayOfYear: ordinal,
    solarAltitude: f3(solarAltitude),
    sunDirection: f3(sunDirection),
    sunStrength: f3(sunStrength),
    daylight: f3(daylight),
    twilight: f3(twilight),
    goldenLight: f3(goldenLight),
    nightDepth: f3(nightDepth),
    moonPhase: f3(moonPhase),
    moonIllumination: f3(moonIllumination),
    moonAltitude: f3(moonAltitude),
    moonDirection: f3(moonDirection),
    moonStrength: f3(moonStrength),
    currentDirection: f3(currentDirection),
    currentStrength: f3(currentStrength),
    phase,
    season,
    seasonWeights: Object.fromEntries(SEASONS.map(key => [key, f3(weights[key])])) as Record<PondSeason, number>,
    waterTemperature: f3(waterTemperature),
    activityRate: f3(activityRate),
    plantCoverage: f3(plantCoverage),
    bloom: f3(bloom),
    summerBloom: f3(weights.summer),
    lotusOpenness: f3(lotusOpenness),
    mapleDrift: f3(weights.autumn),
    iceCoverage: f3(weights.winter),
    surfaceActivity: f3(surfaceActivity),
    winterStillness: f3(weights.winter),
  }
}
