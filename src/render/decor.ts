import { LAYOUT } from '../layout'
import { iceFloeBoundaryPoints, iceFloeLayout, lilyPadLayout, type IceFloeSpec } from '../ecology'
import { rng } from '../prng'
import { f1 } from '../util'
import type { Theme } from './palette'

/** Shared soft-blur filter used by caustics, god rays and the surface sheen. */
export const SOFT_FILTER =
  `<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>`

function smoothClosedPath(points: Array<{ x: number; y: number }>): string {
  let path = `M${f1(points[0].x)} ${f1(points[0].y)}`
  points.forEach((point, pointIndex) => {
    const previous = points[(pointIndex - 1 + points.length) % points.length]
    const next = points[(pointIndex + 1) % points.length]
    const afterNext = points[(pointIndex + 2) % points.length]
    const control1 = {
      x: point.x + (next.x - previous.x) / 6,
      y: point.y + (next.y - previous.y) / 6,
    }
    const control2 = {
      x: next.x - (afterNext.x - point.x) / 6,
      y: next.y - (afterNext.y - point.y) / 6,
    }
    path += ` C${f1(control1.x)} ${f1(control1.y)} ${f1(control2.x)} ${f1(control2.y)} ${f1(next.x)} ${f1(next.y)}`
  })
  return `${path} Z`
}

export function floorBlotches(width: number, r: () => number, opacityScale = 1): string {
  let out = ''
  for (let i = 0; i < 5; i++) {
    const x = f1(width * (0.12 + r() * 0.76))
    const y = f1(24 + r() * (LAYOUT.height - 48))
    const duration = f1(28 + r() * 12)
    const delay = f1(r() * 18)
    const opacity = ((0.26 + r() * 0.14) * opacityScale).toFixed(2)
    const rx = 36 + r() * 54
    const ry = 11 + r() * 14
    const points = Array.from({ length: 10 }, (_, point) => {
      const angle = (point / 10) * Math.PI * 2
      const variance = 0.8 + r() * 0.32
      return { x: Math.cos(angle) * rx * variance, y: Math.sin(angle) * ry * variance }
    })
    out += `<g transform="translate(${x} ${y})"><path class="floor" style="--floor-opacity:${opacity};animation-duration:${duration}s;animation-delay:-${delay}s" d="${smoothClosedPath(points)}" fill="url(#floorG)" filter="url(#floorSoft)"/></g>`
  }
  return out
}

/** Wide, blurred currents add slow variation without competing with the fish. */
export function waterCurrents(width: number, theme: Theme, r: () => number): string {
  let out = ''
  for (let i = 0; i < 3; i++) {
    const y = 42 + i * 55 + (r() - 0.5) * 18
    const bend = 22 + r() * 28
    const d =
      `M-80 ${f1(y)} ` +
      `C${f1(width * 0.2)} ${f1(y - bend)} ${f1(width * 0.34)} ${f1(y + bend)} ${f1(width * 0.53)} ${f1(y)} ` +
      `S${f1(width * 0.82)} ${f1(y - bend)} ${f1(width + 80)} ${f1(y + 4)}`
    out +=
      `<path class="current" style="animation-delay:-${f1(i * 4.6 + r() * 3)}s" d="${d}" ` +
      `fill="none" stroke="${theme.sheen}" stroke-width="${f1(9 + r() * 7)}" stroke-linecap="round" filter="url(#soft)"/>`
  }
  return out
}

/** Sun shafts falling from the water surface, slowly breathing. */
export function godRays(width: number, theme: Theme, r: () => number, sunDirection?: number): string {
  if (!theme.ray) return ''
  let out = ''
  const n = 3
  for (let i = 0; i < n; i++) {
    const xTop = width * (0.14 + (i / (n - 1)) * 0.62) + (r() - 0.5) * width * 0.08
    const wTop = 26 + r() * 30
    const spread = wTop * (2.6 + r() * 1.2)
    const lean = sunDirection === undefined
      ? 40 + r() * 50
      : -sunDirection * (48 + r() * 38) + (r() - 0.5) * 14
    const d =
      `M${f1(xTop)} -4 L${f1(xTop + wTop)} -4 ` +
      `L${f1(xTop + wTop + lean + spread / 2)} ${LAYOUT.height} L${f1(xTop + lean - spread / 2)} ${LAYOUT.height} Z`
    out += `<path class="ray" style="animation-delay:-${f1(i * 3.7 + r() * 2)}s" d="${d}" fill="${theme.ray}" filter="url(#soft)"/>`
  }
  return out
}

/** A restrained directional reflection makes sunrise and sunset read without recoloring the whole pond. */
export function directionalWaterLight(
  width: number,
  sunDirection: number,
  intensity: number,
): string {
  if (intensity < 0.012) return ''
  const centerX = width * (0.5 + sunDirection * 0.29)
  const rotation = sunDirection * -7
  const rx = width * (0.13 + intensity * 0.12)
  const ry = 16 + intensity * 28
  return (
    `<g data-pond-part="directional-light" opacity="${f1(Math.min(0.34, intensity))}">` +
    `<ellipse class="sun-path" cx="${f1(centerX)}" cy="${f1(LAYOUT.height * 0.42)}" ` +
    `rx="${f1(rx)}" ry="${f1(ry)}" transform="rotate(${f1(rotation)} ${f1(centerX)} ${f1(LAYOUT.height * 0.42)})" ` +
    `fill="url(#sunPathG)" filter="url(#soft)"/>` +
    `</g>`
  )
}

/** Moonlight is visible as broken water reflections, never as a literal sky object. */
export function moonWaterLight(
  width: number,
  moonDirection: number,
  strength: number,
): string {
  if (strength < 0.015) return ''
  const centerX = width * (0.5 + moonDirection * 0.24)
  const centerY = LAYOUT.height * 0.35
  const rotation = moonDirection * -5
  const rx = width * (0.045 + strength * 0.045)
  const ry = 10 + strength * 15
  const opacity = Math.min(0.23, 0.035 + strength * 0.195)
  return (
    `<g data-pond-part="moon-light" data-moon-strength="${strength.toFixed(3)}" opacity="${f1(opacity)}">` +
    `<ellipse class="moon-path moon-path-a" cx="${f1(centerX)}" cy="${f1(centerY)}" ` +
    `rx="${f1(rx)}" ry="${f1(ry)}" transform="rotate(${f1(rotation)} ${f1(centerX)} ${f1(centerY)})" ` +
    `fill="url(#moonPathG)" filter="url(#soft)"/>` +
    `<ellipse class="moon-path moon-path-b" cx="${f1(centerX - moonDirection * 5)}" cy="${f1(centerY + 24)}" ` +
    `rx="${f1(rx * 0.64)}" ry="${f1(ry * 0.5)}" fill="url(#moonPathG)" filter="url(#soft)"/>` +
    `</g>`
  )
}

/** Bright band along the top edge so the water reads as a surface seen from above. */
export function surfaceSheen(width: number, theme: Theme, intensity = 1): string {
  return (
    `<g opacity="${f1(intensity)}"><rect width="${width}" height="34" fill="url(#sheenG)"/>` +
    `<rect width="${width}" height="2.5" fill="${theme.sheen}" opacity="${theme.key === 'dark' ? 0.5 : 0.75}"/></g>`
  )
}

/** Darkening toward the bottom for depth. */
export function deepShade(width: number, theme: Theme): string {
  const height = theme.key === 'light' ? 48 : 66
  const opacity = theme.key === 'light' ? 0.68 : 0.82
  return `<rect y="${LAYOUT.height - height}" width="${width}" height="${height}" fill="url(#deepG)" opacity="${opacity}"/>`
}

export function caustics(width: number, theme: Theme): string {
  if (!theme.caustics) return ''
  let out = ''
  const spots = [
    [width * 0.18, 44, 130, 38],
    [width * 0.42, 128, 170, 46],
    [width * 0.66, 58, 150, 42],
    [width * 0.88, 118, 120, 36],
    [width * 0.52, 24, 90, 26],
  ]
  spots.forEach(([x, y, rx, ry], i) => {
    out += `<ellipse class="ca" style="animation-delay:-${(i * 3.3).toFixed(1)}s" cx="${f1(x)}" cy="${f1(y)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="#ffffff" filter="url(#soft)"/>`
  })
  return out
}

function lilyPad(x: number, y: number, radius: number, notchDeg: number, theme: Theme, dur: number): string {
  const a = (notchDeg * Math.PI) / 180
  const half = 0.36
  const x1 = f1(radius * Math.cos(a - half))
  const y1 = f1(radius * Math.sin(a - half))
  const x2 = f1(radius * Math.cos(a + half))
  const y2 = f1(radius * Math.sin(a + half))
  const veins =
    `<path d="M0 0 L${f1(x1 * 0.9)} ${f1(y1 * 0.9)} M0 0 L${f1(-x1 * 0.8)} ${f1(-y1 * 0.8)} M0 0 L${f1(y1 * 0.85)} ${f1(-x1 * 0.85)}"` +
    ` stroke="${theme.lilyVein}" stroke-width="1" fill="none"/>`
  const hl = f1(radius * 0.52)
  return (
    `<g data-pond-part="lily-pad" transform="translate(${f1(x)} ${f1(y)})">` +
    `<ellipse cx="2.5" cy="3.5" rx="${f1(radius)}" ry="${f1(radius * 0.92)}" fill="rgba(0,20,25,0.2)"/>` +
    `<g class="sway" style="animation-duration:${dur}s">` +
    `<path d="M${x1} ${y1} A${radius} ${radius} 0 1 0 ${x2} ${y2} L0 0 Z" fill="${theme.lily}"/>` +
    `<path d="M${x1} ${y1} A${radius} ${radius} 0 1 0 ${x2} ${y2} L0 0 Z" fill="none" stroke="${theme.lilyLight}" stroke-width="1.6" opacity="0.8"/>` +
    `<ellipse cx="${-hl * 0.4}" cy="${-hl * 0.5}" rx="${hl}" ry="${f1(hl * 0.55)}" fill="${theme.lilyLight}" opacity="0.55"/>` +
    `${veins}` +
    `</g></g>`
  )
}

export function lilyPads(width: number, theme: Theme, seed: string, coverage = 1): string {
  const pads = lilyPadLayout(width, seed)
  const visible = Math.max(0, Math.min(1, coverage)) * pads.length
  return pads
    .map((pad, index) => {
      const opacity = Math.max(0, Math.min(1, visible - index))
      return opacity <= 0
        ? ''
        : `<g opacity="${f1(opacity)}">${lilyPad(pad.x, pad.y, pad.radius, pad.notchDeg, theme, f1(pad.duration))}</g>`
    })
    .join('')
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

function lotusState(openness: number) {
  return openness >= 0.72 ? 'open' : openness >= 0.3 ? 'opening' : 'sleeping'
}

function closedLotusBud(theme: Theme, radius: number): string {
  const outerX = f1(radius)
  const outerY = f1(radius * 0.72)
  const petalX = f1(radius * 0.29)
  const petalY = f1(radius * 0.58)
  const side = f1(radius * 0.27)
  return (
    `<ellipse cx="${f1(radius * 0.12)}" cy="${f1(radius * 0.18)}" rx="${f1(radius * 1.04)}" ry="${f1(radius * 0.76)}" fill="rgba(0,20,25,0.14)"/>` +
    `<ellipse rx="${outerX}" ry="${outerY}" fill="${theme.lotusOuter}" opacity="0.58" ` +
    `stroke="${theme.lotusInner}" stroke-width="0.55" stroke-opacity="0.32"/>` +
    `<ellipse cx="-${side}" rx="${petalX}" ry="${petalY}" transform="rotate(-14 -${side} 0)" fill="${theme.lotusOuter}" opacity="0.72"/>` +
    `<ellipse rx="${petalX}" ry="${f1(radius * 0.63)}" fill="${theme.lotusInner}" opacity="0.82"/>` +
    `<ellipse cx="${side}" rx="${petalX}" ry="${petalY}" transform="rotate(14 ${side} 0)" fill="${theme.lotusOuter}" opacity="0.72"/>`
  )
}

function smallLotus(theme: Theme, scale: number, delay: number, openness: number): string {
  const open = clamp01(openness)
  const openOpacity = clamp01((open - 0.16) / 0.72)
  const budOpacity = 1 - clamp01((open - 0.34) / 0.5)
  const openScaleX = 0.42 + open * 0.58
  const openScaleY = 0.24 + open * 0.76
  let petals = ''
  for (let index = 0; index < 7; index++) {
    petals += `<ellipse rx="5.2" ry="2" transform="rotate(${index * (360 / 7)})" fill="${theme.lotusOuter}"/>`
  }
  let inner = ''
  for (let index = 0; index < 5; index++) {
    inner += `<ellipse rx="3.2" ry="1.35" transform="rotate(${18 + index * 72})" fill="${theme.lotusInner}"/>`
  }
  return (
    `<g data-lotus-state="${lotusState(open)}" data-lotus-openness="${open.toFixed(3)}" transform="scale(${f1(scale)})">` +
    `<ellipse cx="1.8" cy="2.5" rx="7.2" ry="6" fill="rgba(0,20,25,0.18)"/>` +
    `<g class="lotus-open-stage" opacity="${openOpacity.toFixed(3)}" transform="scale(${f1(openScaleX)} ${f1(openScaleY)})">` +
    `<g class="bloom" style="animation-delay:-${f1(delay)}s">${petals}${inner}<circle r="1.7" fill="${theme.lotusHeart}"/></g></g>` +
    `<g class="summer-lotus-bud" data-lotus-form="closed-bud" opacity="${(budOpacity * 0.82).toFixed(3)}" style="animation-delay:-${f1(delay * 0.6)}s">` +
    closedLotusBud(theme, 4.2) +
    `</g>` +
    `</g>`
  )
}

function summerBloomSites(width: number, seed: string) {
  const pads = lilyPadLayout(width, seed)
  return [
    { x: pads[0].x + 1, y: pads[0].y - 2, scale: 0.72 },
    { x: pads[1].x + 2, y: pads[1].y - 2, scale: 0.66 },
    { x: pads[2].x - 4, y: pads[2].y + 1, scale: 0.96 },
  ]
}

export function summerBlooms(
  width: number,
  theme: Theme,
  seed: string,
  intensity: number,
  openness = 1,
): string {
  if (intensity < 0.08) return ''
  const blooms = summerBloomSites(width, seed)
    .map(({ x, y, scale }, index) =>
      `<g transform="translate(${f1(x)} ${f1(y)})">${smallLotus(theme, scale, index * 1.7, openness)}</g>`,
    )
    .join('')
  return `<g data-seasonal-part="summer-bloom" opacity="${f1(Math.min(1, intensity * 0.94))}">${blooms}</g>`
}

export function summerFireflies(width: number, seed: string, intensity: number, lotusOpenness = 1): string {
  if (intensity < 0.08) return ''
  const r = rng(`fireflies:${seed}`)
  const blooms = summerBloomSites(width, seed)
  const count = Math.round(7 + Math.min(1, intensity) * 4)
  let fireflies = ''
  let visits = ''
  for (let index = 0; index < count; index++) {
    const bloom = blooms[index % blooms.length]
    const visitingLotus = index < Math.ceil(count * 0.55)
    const angle = r() * Math.PI * 2
    const distance = (visitingLotus ? 24 : 34) + r() * (visitingLotus ? 22 : 48)
    const x = Math.max(18, Math.min(width - 18, bloom.x + Math.cos(angle) * distance))
    const y = Math.max(18, Math.min(LAYOUT.height - 24, bloom.y + Math.sin(angle) * distance * 0.52))
    const targetX = bloom.x - x + (r() - 0.5) * (5 + (1 - lotusOpenness) * 5)
    const targetY = bloom.y - y + (r() - 0.5) * 4
    const x1 = visitingLotus ? targetX * 0.46 + (r() - 0.5) * 14 : (r() - 0.5) * 26
    const y1 = visitingLotus ? targetY * 0.38 + (r() - 0.5) * 10 : (r() - 0.5) * 14
    const x2 = visitingLotus ? targetX : x1 + (r() - 0.5) * 22
    const y2 = visitingLotus ? targetY : y1 + (r() - 0.5) * 15
    const x3 = visitingLotus ? targetX * 0.35 + (r() - 0.5) * 18 : (r() - 0.5) * 20
    const y3 = visitingLotus ? targetY * 0.28 + (r() - 0.5) * 10 : (r() - 0.5) * 12
    const duration = 7.5 + r() * 5
    const delay = r() * duration
    const pulse = 1.5 + r() * 1.6
    const scale = index % 4 === 0 ? 1.08 + r() * 0.16 : 0.88 + r() * 0.16
    fireflies +=
      `<g transform="translate(${f1(x)} ${f1(y)})">` +
      `<g class="firefly-flight" data-firefly-index="${index}" data-firefly-role="${visitingLotus ? 'lotus-visitor' : 'wanderer'}" style="--ffx1:${f1(x1)}px;--ffy1:${f1(y1)}px;--ffx2:${f1(x2)}px;--ffy2:${f1(y2)}px;--ffx3:${f1(x3)}px;--ffy3:${f1(y3)}px;animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s">` +
      `<g transform="scale(${f1(scale)})">` +
      `<g class="firefly-glow" style="animation-duration:${f1(pulse)}s;animation-delay:-${f1(delay * 0.37)}s">` +
      `<circle r="5.2" fill="#dfff75" opacity="0.09"/>` +
      `<circle r="2.5" fill="#eaff8b" opacity="0.24"/>` +
      `<circle r="1" fill="#fbffc9"/>` +
      `</g></g></g></g>`
    if (visitingLotus) {
      visits +=
        `<circle class="lotus-visit" data-lotus-visit="${index}" cx="${f1(bloom.x)}" cy="${f1(bloom.y)}" r="${f1(4.2 + lotusOpenness * 2.2)}" ` +
        `fill="none" stroke="#eaff8b" stroke-width="0.7" style="animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s"/>`
    }
  }
  return `<g data-seasonal-part="summer-fireflies" opacity="${f1(Math.min(0.96, intensity * 0.96))}">${visits}${fireflies}</g>`
}

const MAPLE_PATH =
  'M0 -7 L1.5 -3.2 L4.8 -5 L3.5 -1.2 L7 -0.4 L3.4 1.3 L4.5 5 L1.1 3.2 L0 7 L-1.1 3.2 L-4.5 5 L-3.4 1.3 L-7 -0.4 L-3.5 -1.2 L-4.8 -5 L-1.5 -3.2 Z'

export function autumnMapleLeaves(
  width: number,
  theme: Theme,
  seed: string,
  intensity: number,
  currentDirection = 1,
  currentStrength = 0.5,
): string {
  if (intensity < 0.08) return ''
  const r = rng(`maple:${seed}`)
  const colors = theme.key === 'dark'
    ? ['#a95143', '#b8733e', '#98743d']
    : ['#d85c42', '#e5833d', '#c69a45']
  let leaves = ''
  for (let index = 0; index < 8; index++) {
    const x = 58 + r() * (width - 116)
    const y = 24 + r() * (LAYOUT.height - 52)
    const rotation = r() * 360
    const scale = 0.65 + r() * 0.45
    const direction = currentDirection < 0 ? -1 : 1
    const duration = (34 + r() * 24) / (0.72 + currentStrength * 0.48)
    const delay = r() * duration
    const leftEdge = -x - 24 - r() * 32
    const rightEdge = width - x + 24 + r() * 32
    const startX = direction > 0 ? leftEdge : rightEdge
    const endX = direction > 0 ? rightEdge : leftEdge
    const distance = endX - startX
    const y1 = (r() - 0.5) * 20
    const y2 = (r() - 0.5) * 28
    const y3 = (r() - 0.5) * 18
    leaves +=
      `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rotation)}) scale(${f1(scale)})">` +
      `<g class="maple" style="--mx0:${f1(startX)}px;--mx1:${f1(startX + distance * 0.28)}px;--my1:${f1(y1)}px;--mx2:${f1(startX + distance * 0.63)}px;--my2:${f1(y2)}px;--mx3:${f1(endX)}px;--my3:${f1(y3)}px;animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s">` +
      `<ellipse class="maple-wake" cx="-2" cy="3" rx="7" ry="2.8" fill="none" stroke="${theme.ripple}" stroke-width="0.8"/>` +
      `<g class="maple-body" style="animation-delay:-${f1(delay * 0.37)}s">` +
      `<path d="${MAPLE_PATH}" transform="translate(1.4 1.8)" fill="rgba(0,20,25,0.17)"/>` +
      `<path d="${MAPLE_PATH}" fill="${colors[index % colors.length]}" stroke="rgba(92,48,29,0.24)" stroke-width="0.7"/>` +
      `<path d="M0 2 L0 9" stroke="${colors[(index + 1) % colors.length]}" stroke-width="1" stroke-linecap="round"/>` +
      `</g></g></g>`
  }
  return `<g data-seasonal-part="autumn-maple" opacity="${f1(Math.min(1, intensity * 0.96))}">${leaves}</g>`
}

function smoothIcePath(floe: IceFloeSpec, seed: string, index: number): string {
  return smoothClosedPath(iceFloeBoundaryPoints(floe, seed, index))
}

function snowTracks(floe: IceFloeSpec): string {
  let tracks = ''
  for (let index = 0; index < 8; index++) {
    const offset = index - 4
    tracks += `<ellipse class="snow-track snow-track-${index}" cx="${offset * 12}" cy="${index % 2 === 0 ? -3 : 3}" rx="2.8" ry="1.5" fill="rgba(72,124,138,0.5)" transform="rotate(${index % 2 === 0 ? 18 : -18})"/>`
  }
  return `<g aria-label="turtle tracks in snow" opacity="${floe.rx > 55 ? 1 : 0}">${tracks}</g>`
}

export function winterIce(
  width: number,
  theme: Theme,
  seed: string,
  coverage: number,
  turtleTracks = false,
): string {
  if (coverage < 0.18) return ''
  const floes = iceFloeLayout(width, seed, coverage)
  const visibleCoverage = Math.min(1, (coverage - 0.18) / 0.82)
  const fill = theme.key === 'dark' ? 'rgba(157,211,225,0.38)' : 'rgba(229,247,250,0.82)'
  const rim = theme.key === 'dark' ? 'rgba(191,236,245,0.55)' : 'rgba(255,255,255,0.9)'
  const snow = theme.key === 'dark' ? 'rgba(225,246,250,0.5)' : 'rgba(255,255,255,0.9)'
  const crack = theme.key === 'dark' ? 'rgba(211,244,250,0.3)' : 'rgba(74,137,154,0.32)'
  const r = rng(`snow:${seed}`)
  const elements = floes.map((floe, index) => {
    const path = smoothIcePath(floe, seed, index)
    const snowPatches = Array.from({ length: index === 1 ? 4 : 3 }, () => {
      const x = (r() - 0.5) * floe.rx * 0.95
      const y = (r() - 0.5) * floe.ry * 0.8
      const rx = 7 + r() * 12
      const ry = 2.8 + r() * 4
      return `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="${snow}" opacity="${f1(0.42 + r() * 0.32)}"/>`
    }).join('')
    const tracks = turtleTracks && index === 1 ? snowTracks(floe) : ''
    return (
      `<g data-ice-floe="${index}" transform="translate(${f1(floe.x)} ${f1(floe.y)}) rotate(${f1(floe.rotation)})">` +
      `<path d="${path}" transform="translate(2.5 3.5)" fill="rgba(0,25,35,0.18)"/>` +
      `<path d="${path}" fill="${fill}" stroke="${rim}" stroke-width="1.5"/>` +
      `<g class="ice-glint">${snowPatches}</g>` +
      tracks +
      `<path d="M-${f1(floe.rx * 0.16)} -2 L-${f1(floe.rx * 0.02)} 2 L${f1(floe.rx * 0.08)} -1 M-${f1(floe.rx * 0.02)} 2 L${f1(floe.rx * 0.05)} 7" fill="none" stroke="${crack}" stroke-width="0.9" stroke-linecap="round"/>` +
      `</g>`
    )
  }).join('')
  return `<g data-seasonal-part="winter-ice" opacity="${f1(visibleCoverage * 0.96)}">${elements}</g>`
}

export function winterSnowfall(
  width: number,
  seed: string,
  intensity: number,
  iceCoverage = 0,
  currentDirection = 1,
  currentStrength = 0.5,
): string {
  if (intensity < 0.08) return ''
  const r = rng(`snowfall:${seed}`)
  const count = Math.round(18 + Math.min(1, intensity) * 12)
  const wind = currentDirection * (11 + currentStrength * 20)
  const floes = iceFloeLayout(width, seed, iceCoverage)
  const onFloe = (x: number, y: number) => floes.some(floe => {
    const angle = (-floe.rotation * Math.PI) / 180
    const dx = x - floe.x
    const dy = y - floe.y
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
    return (localX / floe.rx) ** 2 + (localY / floe.ry) ** 2 <= 0.72
  })
  let flakes = ''
  let landings = ''
  for (let index = 0; index < count; index++) {
    const targetFloe = floes.length > 0 && index % 5 === 0 ? floes[index % floes.length] : undefined
    let landingX = targetFloe
      ? targetFloe.x + (r() - 0.5) * targetFloe.rx * 0.7
      : 18 + r() * (width - 36)
    let landingY = targetFloe
      ? targetFloe.y + (r() - 0.5) * targetFloe.ry * 0.52
      : 28 + r() * (LAYOUT.height - 50)
    if (!targetFloe) {
      for (let attempt = 0; attempt < 5 && onFloe(landingX, landingY); attempt++) {
        landingX = 18 + r() * (width - 36)
        landingY = 28 + r() * (LAYOUT.height - 50)
      }
    }
    const landsOnIce = onFloe(landingX, landingY)
    const desiredDrift = wind + (r() - 0.5) * 22
    const x = Math.max(8, Math.min(width - 8, landingX - desiredDrift))
    const drift = landingX - x
    const x1 = drift * 0.28 + (r() - 0.5) * 11
    const x2 = drift * 0.65 + (r() - 0.5) * 12
    const near = index % 6 === 0
    const middle = !near && index % 3 === 0
    const depth = near ? 'near' : middle ? 'middle' : 'far'
    const duration = near ? 7.5 + r() * 3 : middle ? 9.5 + r() * 4 : 12 + r() * 7
    const delay = r() * duration
    const scale = near ? 1.45 + r() * 0.45 : middle ? 0.95 + r() * 0.35 : 0.55 + r() * 0.31
    const opacity = near ? 0.8 + r() * 0.16 : middle ? 0.62 + r() * 0.18 : 0.42 + r() * 0.18
    const flake = near
      ? `<circle r="4" fill="#dff8ff" opacity="0.1"/><path d="M-2.4 0 H2.4 M0 -2.4 V2.4 M-1.7 -1.7 L1.7 1.7 M1.7 -1.7 L-1.7 1.7" fill="none" stroke="#f1fdff" stroke-width="0.5" stroke-linecap="round"/><circle r="0.68" fill="#ffffff"/>`
      : middle
        ? `<path d="M-1.7 0 H1.7 M0 -1.7 V1.7" fill="none" stroke="#eefcff" stroke-width="0.6" stroke-linecap="round"/><circle r="0.6" fill="#ffffff"/>`
        : `<circle r="1.12" fill="#e8f9fc"/>`
    flakes +=
      `<g data-snow-index="${index}" data-snow-depth="${depth}" data-snow-landing="${landsOnIce ? 'ice' : 'water'}" transform="translate(${f1(x)} 0)">` +
      `<g class="snowfall" style="--snow-x1:${f1(x1)}px;--snow-y1:${f1(landingY * 0.3)}px;--snow-x2:${f1(x2)}px;--snow-y2:${f1(landingY * 0.66)}px;--snow-x3:${f1(drift)}px;--snow-y3:${f1(landingY)}px;--snow-opacity:${opacity.toFixed(2)};animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s">` +
      `<g transform="scale(${f1(scale)})">${flake}</g>` +
      `</g></g>`
    landings += landsOnIce
      ? `<g data-snow-index="${index}" data-snow-effect="ice" transform="translate(${f1(landingX)} ${f1(landingY)}) scale(${f1(scale)})"><circle class="snow-settle" r="1.2" fill="#f5fdff" style="animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s"/></g>`
      : `<circle data-snow-index="${index}" data-snow-effect="water" class="snow-melt" cx="${f1(landingX)}" cy="${f1(landingY)}" r="3.4" fill="none" stroke="#dff8ff" stroke-width="0.65" style="animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s"/>`
  }
  return `<g data-seasonal-part="winter-snowfall" opacity="${f1(Math.min(0.96, intensity * 0.96))}">${landings}${flakes}</g>`
}

export function lotus(
  x: number,
  theme: Theme,
  r: () => number,
  openness = 1,
  compactNightBloom = false,
): string {
  const y = 24 + r() * 6
  const open = clamp01(openness)
  const openOpacity = clamp01((open - 0.16) / 0.72)
  const budOpacity = 1 - clamp01((open - 0.34) / 0.5)
  const openScaleX = 0.42 + open * 0.58
  const openScaleY = 0.24 + open * 0.76
  let petals = ''
  for (let k = 0; k < 8; k++) {
    petals += `<ellipse rx="7" ry="2.9" transform="rotate(${k * 45})" fill="${theme.lotusOuter}"/>`
  }
  let inner = ''
  for (let k = 0; k < 5; k++) {
    inner += `<ellipse rx="4.6" ry="2" transform="rotate(${22 + k * 72})" fill="${theme.lotusInner}"/>`
  }
  const closedStage = compactNightBloom
    ? `<g class="summer-lotus-bud" data-lotus-form="closed-bud" opacity="${(budOpacity * 0.78).toFixed(3)}">` +
      closedLotusBud(theme, 5.8) +
      `</g>`
    : `<g class="lotus-bud" opacity="${budOpacity.toFixed(3)}">` +
      `<ellipse rx="3.5" ry="8" fill="${theme.lotusOuter}"/>` +
      `<ellipse rx="2.8" ry="7" transform="rotate(25)" fill="${theme.lotusInner}"/>` +
      `<ellipse rx="2.8" ry="7" transform="rotate(-25)" fill="${theme.lotusOuter}"/>` +
      `</g>`
  return (
    `<g transform="translate(${f1(x)} ${f1(y)})">` +
    `<ellipse cx="2.5" cy="3.5" rx="13" ry="12" fill="rgba(0,20,25,0.2)"/>` +
    `<circle r="12.5" fill="${theme.lily}" opacity="0.9"/>` +
    `<circle r="12.5" fill="none" stroke="${theme.lilyLight}" stroke-width="1.4" opacity="0.8"/>` +
    `<g data-lotus-state="${lotusState(open)}" data-lotus-openness="${open.toFixed(3)}">` +
    `<g class="lotus-open-stage" opacity="${openOpacity.toFixed(3)}" transform="scale(${f1(openScaleX)} ${f1(openScaleY)})">` +
    `<g class="bloom">${petals}${inner}<circle r="2.3" fill="${theme.lotusHeart}"/></g></g>` +
    closedStage +
    `</g>` +
    `</g>`
  )
}

export function pebbles(theme: Theme, r: () => number): string {
  let out = ''
  const cx = 46 + r() * 20
  const cy = LAYOUT.height - 22
  for (let i = 0; i < 5; i++) {
    const x = f1(cx + (r() - 0.3) * 42)
    const y = f1(cy + (r() - 0.5) * 14)
    const rad = f1(2.6 + r() * 3.2)
    out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${theme.pebbles[i % theme.pebbles.length]}" opacity="0.85"/>`
    out += `<circle cx="${f1(x - rad * 0.3)}" cy="${f1(y - rad * 0.35)}" r="${f1(rad * 0.4)}" fill="${theme.sheen}" opacity="0.35"/>`
  }
  return out
}

export function motes(width: number, theme: Theme, r: () => number, count = 8): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = f1(30 + r() * (width - 60))
    const y = f1(30 + r() * (LAYOUT.height - 70))
    out += `<circle class="mo" style="animation-duration:${f1(8 + r() * 7)}s;animation-delay:-${f1(r() * 12)}s" cx="${x}" cy="${y}" r="${f1(0.8 + r() * 0.9)}" fill="${theme.mote}"/>`
  }
  return out
}

export function ambientRipples(width: number, theme: Theme, r: () => number, count = 3): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = f1(50 + r() * (width - 100))
    const y = f1(30 + r() * (LAYOUT.height - 70))
    out += `<circle class="ar" style="animation-delay:-${f1(r() * 9)}s" cx="${x}" cy="${y}" r="9" fill="none" stroke="${theme.ripple}" stroke-width="1"/>`
  }
  return out
}

export function turtle(theme: Theme, motionAttributes = ''): string {
  const flipper = (name: string, x: number, y: number, deg: number, delay: number) =>
    `<g transform="rotate(${deg} ${x} ${y})"><g class="paddle-phase ${name}"><ellipse class="paddle" style="animation-delay:${delay}s" cx="${x}" cy="${y}" rx="4.4" ry="1.9" fill="${theme.turtleSkin}"/></g></g>`
  return (
    `<g class="turtle" data-pond-part="turtle"${motionAttributes}>` +
    `<g class="turtle-scale" transform="scale(1.1)">` +
    `<ellipse class="turtle-shadow" cx="2.5" cy="4" rx="11.5" ry="10" fill="rgba(0,20,25,0.2)"/>` +
    `<g class="turtle-body">` +
    flipper('paddle-front-left', -7, -8, -38, 0) +
    flipper('paddle-rear-left', -7, 8, 38, -0.65) +
    flipper('paddle-front-right', 6, -8.5, 32, -0.65) +
    flipper('paddle-rear-right', 6, 8.5, -32, 0) +
    `<ellipse cx="-11.5" cy="0" rx="2.2" ry="1.6" fill="${theme.turtleSkin}"/>` +
    `<circle cx="12.5" cy="0" r="3.4" fill="${theme.turtleSkin}"/>` +
    `<circle r="10" fill="${theme.turtleShell}"/>` +
    `<circle r="6.6" fill="none" stroke="${theme.turtleRing}" stroke-width="1.1"/>` +
    `<path d="M0 -6.6 V6.6 M-5.7 -3.3 L5.7 3.3 M-5.7 3.3 L5.7 -3.3" stroke="${theme.turtleRing}" stroke-width="1.1"/>` +
    `<path d="M-3.5 -8.6 A9.2 9.2 0 0 1 5 -7.8" fill="none" stroke="${theme.sheen}" stroke-width="1.3" opacity="0.4" stroke-linecap="round"/>` +
    `<circle cx="13.4" cy="-1.2" r="0.7" fill="#10222c"/><circle cx="13.4" cy="1.2" r="0.7" fill="#10222c"/>` +
    `</g></g></g>`
  )
}
