import type { PondEnvironment, PondSeason } from '../environment'

export interface KoiVariantColors {
  base: string
  patch: string
  fin: string
  eye: string
}

export interface Theme {
  key: 'light' | 'dark'
  waterTop: string
  waterMid: string
  waterBottom: string
  floorBlotch: string
  sheen: string
  ray: string | null
  deep: string
  vignette: string
  plankton: readonly [string, string, string, string]
  halo: string | null
  ripple: string
  koi: readonly KoiVariantColors[]
  minnow: readonly string[]
  fishFilter: string
  lily: string
  lilyLight: string
  lilyVein: string
  lotusOuter: string
  lotusInner: string
  lotusHeart: string
  pebbles: readonly string[]
  mote: string
  caustics: boolean
  night: number
  nightTint: string
  turtleShell: string
  turtleSkin: string
  turtleRing: string
}

export const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    key: 'light',
    waterTop: '#a8e4ee',
    waterMid: '#5fb6cb',
    waterBottom: '#4193ab',
    floorBlotch: '#287c94',
    sheen: 'rgba(255,255,255,0.55)',
    ray: '#ffffff',
    deep: 'rgba(8,58,76,0.17)',
    vignette: 'rgba(4,44,58,0.14)',
    plankton: ['#a9ecb6', '#4cd476', '#1fa34b', '#147639'],
    halo: null,
    ripple: '#f2feff',
    koi: [
      { base: '#fdf9f0', patch: '#ef5a1d', fin: 'rgba(253,249,240,0.7)', eye: '#2b2622' },
      { base: '#f6b23e', patch: '#e07d1f', fin: 'rgba(252,242,222,0.65)', eye: '#2b2622' },
      { base: '#f9f4ea', patch: '#d8452c', fin: 'rgba(253,249,240,0.7)', eye: '#2b2622' },
    ],
    minnow: ['#5f879c', '#e0704d', '#6f9c56'],
    fishFilter: `<filter id="fx" filterUnits="userSpaceOnUse" x="-70" y="-70" width="240%" height="240%"><feDropShadow dx="0.8" dy="2.8" stdDeviation="3.4" flood-color="#063340" flood-opacity="0.18"/></filter>`,
    lily: '#35855c',
    lilyLight: 'rgba(255,255,255,0.22)',
    lilyVein: 'rgba(10,60,40,0.28)',
    lotusOuter: '#f299c0',
    lotusInner: '#f8cddd',
    lotusHeart: '#f5cf5f',
    pebbles: ['#5d96a8', '#4c869c', '#74a7b6'],
    mote: '#ffffff',
    caustics: true,
    night: 0.4,
    nightTint: '#000d14',
    turtleShell: '#549647',
    turtleSkin: '#86bb71',
    turtleRing: 'rgba(20,60,30,0.38)',
  },
  dark: {
    key: 'dark',
    waterTop: '#0d2c42',
    waterMid: '#071c2e',
    waterBottom: '#010810',
    floorBlotch: '#0e2c3d',
    sheen: 'rgba(125,211,252,0.14)',
    ray: null,
    deep: 'rgba(0,0,0,0.5)',
    vignette: 'rgba(0,0,0,0.45)',
    plankton: ['#1d7183', '#1295af', '#13c3e2', '#8df7ff'],
    halo: '#22d3ee',
    ripple: '#38e0f8',
    koi: [
      { base: 'rgba(215,242,250,0.95)', patch: 'rgba(167,139,250,0.95)', fin: 'rgba(170,228,248,0.5)', eye: '#0b2231' },
      { base: 'rgba(188,233,248,0.93)', patch: 'rgba(244,114,182,0.9)', fin: 'rgba(170,228,248,0.5)', eye: '#0b2231' },
      { base: 'rgba(226,244,252,0.95)', patch: 'rgba(74,222,128,0.9)', fin: 'rgba(170,228,248,0.5)', eye: '#0b2231' },
    ],
    minnow: ['rgba(125,211,252,0.9)', 'rgba(167,139,250,0.85)', 'rgba(94,234,212,0.85)'],
    fishFilter: `<filter id="fx" filterUnits="userSpaceOnUse" x="-70" y="-70" width="240%" height="240%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#22d3ee" flood-opacity="0.8"/></filter>`,
    lily: '#166154',
    lilyLight: 'rgba(160,240,250,0.16)',
    lilyVein: 'rgba(120,220,230,0.22)',
    lotusOuter: '#9be9f7',
    lotusInner: '#c9f4fb',
    lotusHeart: '#a78bfa',
    pebbles: ['#183349', '#213d57', '#122940'],
    mote: '#7dd3fc',
    caustics: false,
    night: 0.24,
    nightTint: '#000d14',
    turtleShell: '#176853',
    turtleSkin: '#238a72',
    turtleRing: 'rgba(127,243,255,0.3)',
  },
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

interface SeasonalDayPalette {
  waterTop: string
  waterMid: string
  waterBottom: string
  floorBlotch: string
  plankton: readonly [string, string, string, string]
  lily: string
  lotusOuter: string
  lotusInner: string
  accent: string
}

interface SeasonalNightPalette extends SeasonalDayPalette {
  sheen: string
  ripple: string
  mote: string
  nightTint: string
}

const SEASONAL_DAY: Record<PondSeason, SeasonalDayPalette> = {
  spring: {
    waterTop: THEMES.light.waterTop,
    waterMid: THEMES.light.waterMid,
    waterBottom: THEMES.light.waterBottom,
    floorBlotch: THEMES.light.floorBlotch,
    plankton: ['#a9ecb6', '#4cd476', '#1fa34b', '#147639'],
    lily: THEMES.light.lily,
    lotusOuter: THEMES.light.lotusOuter,
    lotusInner: THEMES.light.lotusInner,
    accent: THEMES.light.lotusHeart,
  },
  summer: {
    waterTop: '#a4e3eb',
    waterMid: '#58b4c6',
    waterBottom: '#3d91a7',
    floorBlotch: '#2b7f94',
    plankton: ['#c2f09e', '#69d65c', '#2b9f45', '#176c37'],
    lily: '#28784a',
    lotusOuter: '#ef8cab',
    lotusInner: '#f6c4d2',
    accent: '#f0cb52',
  },
  autumn: {
    waterTop: '#a9dfe5',
    waterMid: '#60afbc',
    waterBottom: '#438b9f',
    floorBlotch: '#477f88',
    plankton: ['#e0dc8d', '#b7bd58', '#7d8f3e', '#53652f'],
    lily: '#78804b',
    lotusOuter: '#cf826c',
    lotusInner: '#e3ae91',
    accent: '#d5aa55',
  },
  winter: {
    waterTop: '#b1e0e7',
    waterMid: '#65acb9',
    waterBottom: '#477f93',
    floorBlotch: '#4d7d88',
    plankton: ['#d2e2dc', '#9abcb4', '#668f8b', '#42686b'],
    lily: '#61756f',
    lotusOuter: '#bdcdd2',
    lotusInner: '#dce6e8',
    accent: '#aecbd3',
  },
}

const SEASONAL_NIGHT: Record<PondSeason, SeasonalNightPalette> = {
  spring: {
    waterTop: '#12384a',
    waterMid: '#082337',
    waterBottom: '#020c15',
    floorBlotch: '#123748',
    plankton: ['#285f68', '#1d8b85', '#24bfa0', '#8ce6c8'],
    lily: '#175d50',
    lotusOuter: '#9acfd5',
    lotusInner: '#c7e7e8',
    accent: '#8ee6d2',
    sheen: '#91d4d8',
    ripple: '#4ad8dd',
    mote: '#9de6df',
    nightTint: '#06131a',
  },
  summer: {
    waterTop: '#123a46',
    waterMid: '#082631',
    waterBottom: '#020d13',
    floorBlotch: '#143b42',
    plankton: ['#236f7a', '#168f9f', '#19bebe', '#9ff4e1'],
    lily: '#175e46',
    lotusOuter: '#d68da8',
    lotusInner: '#ecc4d2',
    accent: '#d9c66a',
    sheen: '#91d7c9',
    ripple: '#4bd9d0',
    mote: '#d9e6a8',
    nightTint: '#071316',
  },
  autumn: {
    waterTop: '#1a3444',
    waterMid: '#0c2230',
    waterBottom: '#050c12',
    floorBlotch: '#24363b',
    plankton: ['#315f6b', '#2b8292', '#39a9b5', '#a7e3df'],
    lily: '#485646',
    lotusOuter: '#aa7467',
    lotusInner: '#cf9b7e',
    accent: '#d1aa66',
    sheen: '#b6a98a',
    ripple: '#81b6bd',
    mote: '#d4b76d',
    nightTint: '#0b1116',
  },
  winter: {
    waterTop: '#173445',
    waterMid: '#0a2232',
    waterBottom: '#020b12',
    floorBlotch: '#203943',
    plankton: ['#41636d', '#5d8994', '#83b7c0', '#c8edf3'],
    lily: '#435c5f',
    lotusOuter: '#9fbac2',
    lotusInner: '#d2e5e9',
    accent: '#a7c8d4',
    sheen: '#b9dce5',
    ripple: '#8edff0',
    mote: '#c8edf3',
    nightTint: '#07131c',
  },
}

const parseColor = (value: string): Rgba => {
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      }
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    }
  }
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
  return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 }
}

const formatColor = ({ r, g, b, a }: Rgba) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Number(a.toFixed(3))})`

const mixColor = (from: string, to: string, amount: number) => {
  const a = parseColor(from)
  const b = parseColor(to)
  return formatColor({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
    a: a.a + (b.a - a.a) * amount,
  })
}

const mixNumber = (from: number, to: number, amount: number) => from + (to - from) * amount

const weightedSeasonColor = <Palette extends SeasonalDayPalette>(
  environment: PondEnvironment,
  palettes: Record<PondSeason, Palette>,
  pick: (palette: Palette) => string,
) => {
  let value: Rgba = { r: 0, g: 0, b: 0, a: 0 }
  for (const season of Object.keys(palettes) as PondSeason[]) {
    const source = parseColor(pick(palettes[season]))
    const weight = environment.seasonWeights[season]
    value = {
      r: value.r + source.r * weight,
      g: value.g + source.g * weight,
      b: value.b + source.b * weight,
      a: value.a + source.a * weight,
    }
  }
  return formatColor(value)
}

function seasonalDayTheme(environment: PondEnvironment): Theme {
  const color = (pick: (palette: SeasonalDayPalette) => string) =>
    weightedSeasonColor(environment, SEASONAL_DAY, pick)
  return {
    ...THEMES.light,
    waterTop: color(palette => palette.waterTop),
    waterMid: color(palette => palette.waterMid),
    waterBottom: color(palette => palette.waterBottom),
    floorBlotch: color(palette => palette.floorBlotch),
    plankton: [
      color(palette => palette.plankton[0]),
      color(palette => palette.plankton[1]),
      color(palette => palette.plankton[2]),
      color(palette => palette.plankton[3]),
    ],
    lily: color(palette => palette.lily),
    lotusOuter: color(palette => palette.lotusOuter),
    lotusInner: color(palette => palette.lotusInner),
    lotusHeart: color(palette => palette.accent),
  }
}

function seasonalNightTheme(environment: PondEnvironment): Theme {
  const color = (pick: (palette: SeasonalNightPalette) => string) =>
    weightedSeasonColor(environment, SEASONAL_NIGHT, pick)
  return {
    ...THEMES.dark,
    waterTop: color(palette => palette.waterTop),
    waterMid: color(palette => palette.waterMid),
    waterBottom: color(palette => palette.waterBottom),
    floorBlotch: color(palette => palette.floorBlotch),
    plankton: [
      color(palette => palette.plankton[0]),
      color(palette => palette.plankton[1]),
      color(palette => palette.plankton[2]),
      color(palette => palette.plankton[3]),
    ],
    lily: color(palette => palette.lily),
    lotusOuter: color(palette => palette.lotusOuter),
    lotusInner: color(palette => palette.lotusInner),
    lotusHeart: color(palette => palette.accent),
    sheen: color(palette => palette.sheen),
    ripple: color(palette => palette.ripple),
    mote: color(palette => palette.mote),
    nightTint: color(palette => palette.nightTint),
    night: 0.19 + environment.nightDepth * 0.07,
  }
}

function blendTheme(from: Theme, to: Theme, amount: number): Theme {
  const mixKoi = (index: number): KoiVariantColors => ({
    base: mixColor(from.koi[index].base, to.koi[index].base, amount),
    patch: mixColor(from.koi[index].patch, to.koi[index].patch, amount),
    fin: mixColor(from.koi[index].fin, to.koi[index].fin, amount),
    eye: mixColor(from.koi[index].eye, to.koi[index].eye, amount),
  })
  return {
    key: amount >= 0.46 ? 'light' : 'dark',
    waterTop: mixColor(from.waterTop, to.waterTop, amount),
    waterMid: mixColor(from.waterMid, to.waterMid, amount),
    waterBottom: mixColor(from.waterBottom, to.waterBottom, amount),
    floorBlotch: mixColor(from.floorBlotch, to.floorBlotch, amount),
    sheen: mixColor(from.sheen, to.sheen, amount),
    ray: amount > 0.08 ? mixColor('rgba(255,255,255,0)', to.ray ?? '#ffffff', amount) : null,
    deep: mixColor(from.deep, to.deep, amount),
    vignette: mixColor(from.vignette, to.vignette, amount),
    plankton: [
      mixColor(from.plankton[0], to.plankton[0], amount),
      mixColor(from.plankton[1], to.plankton[1], amount),
      mixColor(from.plankton[2], to.plankton[2], amount),
      mixColor(from.plankton[3], to.plankton[3], amount),
    ],
    halo: amount < 0.82 ? mixColor(from.halo ?? 'rgba(34,211,238,0)', 'rgba(34,211,238,0)', amount) : null,
    ripple: mixColor(from.ripple, to.ripple, amount),
    koi: from.koi.map((_, index) => mixKoi(index)) as Theme['koi'],
    minnow: from.minnow.map((color, index) => mixColor(color, to.minnow[index], amount)) as Theme['minnow'],
    fishFilter: amount >= 0.46 ? to.fishFilter : from.fishFilter,
    lily: mixColor(from.lily, to.lily, amount),
    lilyLight: mixColor(from.lilyLight, to.lilyLight, amount),
    lilyVein: mixColor(from.lilyVein, to.lilyVein, amount),
    lotusOuter: mixColor(from.lotusOuter, to.lotusOuter, amount),
    lotusInner: mixColor(from.lotusInner, to.lotusInner, amount),
    lotusHeart: mixColor(from.lotusHeart, to.lotusHeart, amount),
    pebbles: from.pebbles.map((color, index) => mixColor(color, to.pebbles[index], amount)) as Theme['pebbles'],
    mote: mixColor(from.mote, to.mote, amount),
    caustics: amount > 0.24,
    night: mixNumber(from.night, to.night, amount),
    nightTint: mixColor(from.nightTint, to.nightTint, amount),
    turtleShell: mixColor(from.turtleShell, to.turtleShell, amount),
    turtleSkin: mixColor(from.turtleSkin, to.turtleSkin, amount),
    turtleRing: mixColor(from.turtleRing, to.turtleRing, amount),
  }
}

export function themeForEnvironment(environment: PondEnvironment): Theme {
  const dayTheme = seasonalDayTheme(environment)
  const nightTheme = seasonalNightTheme(environment)
  const theme = blendTheme(nightTheme, dayTheme, environment.daylight)

  const isMorning = environment.minuteOfDay < 720
  const twilightColor = isMorning ? '#e7a58f' : '#77618c'
  const twilightAmount = environment.twilight * 0.36
  theme.waterTop = mixColor(theme.waterTop, twilightColor, twilightAmount)
  theme.waterMid = mixColor(theme.waterMid, isMorning ? '#8e8290' : '#4f466f', twilightAmount * 0.72)
  theme.sheen = mixColor(theme.sheen, isMorning ? '#ffd2ae' : '#d5a6bd', environment.twilight * 0.52)

  const goldenAmount = environment.goldenLight * 0.26
  theme.waterTop = mixColor(theme.waterTop, isMorning ? '#f3bf98' : '#c88ea4', goldenAmount)
  theme.waterMid = mixColor(theme.waterMid, isMorning ? '#8aa6ad' : '#707b94', goldenAmount * 0.48)
  theme.sheen = mixColor(theme.sheen, isMorning ? '#ffe0b9' : '#f0b9cc', Math.min(1, goldenAmount * 2.5))
  theme.waterTop = mixColor(theme.waterTop, '#d6f5f4', environment.sunStrength * environment.daylight * 0.1)
  theme.waterMid = mixColor(theme.waterMid, '#82cad2', environment.sunStrength * environment.daylight * 0.035)

  const moonAmount = environment.moonStrength
  theme.waterTop = mixColor(theme.waterTop, '#c7e6f4', moonAmount * 0.13)
  theme.waterMid = mixColor(theme.waterMid, '#759cb7', moonAmount * 0.055)
  theme.sheen = mixColor(theme.sheen, '#e2f6ff', moonAmount * 0.34)
  theme.ripple = mixColor(theme.ripple, '#d8f5ff', moonAmount * 0.22)
  theme.mote = mixColor(theme.mote, '#e9f9ff', moonAmount * 0.18)
  theme.night = Math.max(0.12, theme.night * (1 - moonAmount * 0.2))

  const daylightFish = environment.solarAltitude >= 2
  theme.koi = daylightFish ? dayTheme.koi : THEMES.dark.koi
  theme.minnow = daylightFish ? dayTheme.minnow : THEMES.dark.minnow
  theme.halo = environment.solarAltitude < -4 ? THEMES.dark.halo : null
  if (daylightFish) {
    const shadowReach = 3.2 + environment.goldenLight * 2.8
    const shadowX = 0.8 - environment.sunDirection * shadowReach
    const shadowY = 2.8 + environment.goldenLight * 2.4
    const shadowBlur = 3.1 + environment.goldenLight * 0.8
    const shadowOpacity = 0.18 + environment.goldenLight * 0.1
    theme.fishFilter = `<filter id="fx" filterUnits="userSpaceOnUse" x="-70" y="-70" width="240%" height="240%"><feDropShadow dx="${shadowX.toFixed(1)}" dy="${shadowY.toFixed(1)}" stdDeviation="${shadowBlur.toFixed(1)}" flood-color="#063340" flood-opacity="${shadowOpacity.toFixed(2)}"/></filter>`
  } else {
    theme.fishFilter = THEMES.dark.fishFilter
  }
  return theme
}
