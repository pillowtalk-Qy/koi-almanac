import { LAYOUT } from '../layout'
import { iceFloeBoundaryPoints, iceFloeLayout, lilyPadLayout, type IceFloeSpec } from '../ecology'
import { rng } from '../prng'
import { f1 } from '../util'
import { mixColor, type Theme } from './palette'

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
  const edgeOpacity = 0.5 + theme.lightLevel * 0.25
  return (
    `<g opacity="${f1(intensity)}"><rect width="${width}" height="34" fill="url(#sheenG)"/>` +
    `<rect width="${width}" height="2.5" fill="${theme.sheen}" opacity="${f1(edgeOpacity)}"/></g>`
  )
}

/** Darkening toward the bottom for depth. */
export function deepShade(width: number, theme: Theme): string {
  const height = 66 - theme.lightLevel * 18
  const opacity = 0.82 - theme.lightLevel * 0.14
  return `<rect y="${f1(LAYOUT.height - height)}" width="${width}" height="${f1(height)}" fill="url(#deepG)" opacity="${f1(opacity)}"/>`
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

interface SpringPlantSite {
  x: number
  y: number
  rotation: number
  scale: number
  blades: number
  shoots: number
  kind: 'ribbon' | 'pondweed' | 'fanwort'
}

function springBladePath(length: number, width: number, bend: number): string {
  return (
    `M-${f1(width * 0.5)} 0 ` +
    `C-${f1(width * 0.75)} -${f1(length * 0.34)} ${f1(bend - width * 0.48)} -${f1(length * 0.72)} ${f1(bend)} -${f1(length)} ` +
    `C${f1(bend + width * 0.48)} -${f1(length * 0.72)} ${f1(width * 0.75)} -${f1(length * 0.34)} ${f1(width * 0.5)} 0 Z`
  )
}

function springPondweedSprig(
  length: number,
  bend: number,
  fill: string,
  highlight: string,
  variant: number,
  tipStyle: string,
  tipId: string,
): string {
  const nodes = [0.31 + variant * 0.025, 0.57 - variant * 0.018, 0.79 + variant * 0.012]
  const leaves = nodes
    .map((position, index) => {
      const x = bend * position * (0.72 + position * 0.28)
      const y = -length * position
      const side = (index + (variant > 0.28 ? 1 : 0)) % 2 === 0 ? -1 : 1
      const leafLength = 7.4 - index * 0.65 + variant * side * 0.9
      const leafWidth = 2.4 - index * 0.15 + variant * 0.16
      const tipX = side * leafLength
      const tipY = -leafLength * (0.32 + index * 0.05 + variant * 0.025)
      return (
        `<g transform="translate(${f1(x)} ${f1(y)})">` +
        `<path d="M0 0 C${f1(tipX * 0.34)} ${f1(tipY - leafWidth)} ${f1(tipX * 0.82)} ${f1(tipY - leafWidth * 0.6)} ${f1(tipX)} ${f1(tipY)} ` +
        `C${f1(tipX * 0.7)} ${f1(tipY + leafWidth * 0.84)} ${f1(tipX * 0.22)} ${f1(leafWidth * 0.5)} 0 0 Z" fill="${fill}"/>` +
        `</g>`
      )
    })
    .join('')
  return (
    `<path d="M0 0 C0 -${f1(length * 0.34)} ${f1(bend * 0.62)} -${f1(length * 0.72)} ${f1(bend)} -${f1(length)}" ` +
    `fill="none" stroke="${highlight}" stroke-width="0.9" stroke-linecap="round" opacity="0.76"/>` +
    `<g class="spring-tip" data-spring-tip="${tipId}" style="${tipStyle}">` +
    leaves +
    `<path d="M${f1(bend)} -${f1(length)} q-${f1(3.5 + variant * 0.8)} ${f1(1.1 - variant * 0.25)} -${f1(4.7 + variant * 0.9)} ${f1(3.9 + variant * 0.3)} ` +
    `M${f1(bend)} -${f1(length)} q${f1(3.9 - variant * 0.5)} ${f1(0.8 + variant * 0.25)} ${f1(5.1 - variant * 0.4)} ${f1(3.6 - variant * 0.35)}" ` +
    `fill="none" stroke="${fill}" stroke-width="1.8" stroke-linecap="round"/>` +
    `</g>`
  )
}

function springFanwortSprig(
  length: number,
  bend: number,
  stem: string,
  leaf: string,
  variant: number,
  tipStyle: string,
  tipId: string,
): string {
  const crownX = bend * 0.88
  const crownY = -length * 0.82
  const fan = [
    [-7.4, -0.8], [-5.4, -4.8], [-2.3, -7], [1.2, -7.8], [4.7, -5.4], [7.1, -1.8],
  ].filter((_, index) => !(Math.abs(variant) > 0.62 && index === (variant > 0 ? 1 : 4)))
    .map(([dx, dy], index) => {
      const spread = 1 + variant * (dx < 0 ? 0.09 : -0.06)
      const lift = dy + variant * (index % 2 === 0 ? 0.9 : -0.7)
      return (
        `<path d="M${f1(crownX)} ${f1(crownY)} Q${f1(crownX + dx * spread * 0.45)} ${f1(crownY + lift * 0.72)} ${f1(crownX + dx * spread)} ${f1(crownY + lift)}" ` +
        `fill="none" stroke="${leaf}" stroke-width="${index === 0 || index === 5 ? '1.15' : '1.35'}" stroke-linecap="round"/>`
      )
    })
    .join('')
  const lowerFanY = -length * 0.57
  const lowerFanX = bend * 0.57
  return (
    `<path d="M0 0 C${f1(bend * 0.08)} -${f1(length * 0.34)} ${f1(bend * 0.62)} -${f1(length * 0.72)} ${f1(bend)} -${f1(length)}" ` +
    `fill="none" stroke="${stem}" stroke-width="1.35" stroke-linecap="round"/>` +
    `<g class="spring-tip" data-spring-tip="${tipId}" style="${tipStyle}">` +
    `<path d="M${f1(lowerFanX)} ${f1(lowerFanY)} q-${f1(4.6 + variant * 0.8)} -${f1(4.4 - variant * 0.35)} -${f1(7.5 + variant)} -${f1(2.5 + variant * 0.2)} ` +
    `M${f1(lowerFanX)} ${f1(lowerFanY)} q${f1(5.1 - variant * 0.5)} -${f1(4.1 + variant * 0.3)} ${f1(7.7 - variant * 0.7)} -${f1(1.9 - variant * 0.2)}" ` +
    `fill="none" stroke="${leaf}" stroke-width="1.05" stroke-linecap="round"/>` +
    fan +
    `</g>`
  )
}

export function springWaterPlants(
  width: number,
  theme: Theme,
  seed: string,
  intensity: number,
  currentDirection = 1,
  currentStrength = 0.5,
  surfaceActivity = 1,
  daylight = 1,
): string {
  if (intensity < 0.08) return ''
  const r = rng(`spring-growth:${seed}`)
  const direction = currentDirection < 0 ? -1 : 1
  const strength = clamp01(currentStrength)
  const surface = clamp01(surfaceActivity)
  const growth = 0.58 + clamp01(intensity) * 0.42
  const sites: SpringPlantSite[] = [
    { x: width * 0.12, y: LAYOUT.height - 3, rotation: -1.5, scale: 1.18, blades: 5, shoots: 1, kind: 'ribbon' },
    { x: width * 0.61, y: LAYOUT.height - 9, rotation: 1.3, scale: 0.92, blades: 3, shoots: 0, kind: 'pondweed' },
    { x: width * 0.85, y: LAYOUT.height - 4, rotation: -0.8, scale: 1.08, blades: 3, shoots: 1, kind: 'fanwort' },
  ]
  const clusters = sites.map((site, clusterIndex) => {
    const bias = direction * strength * (1.35 + clusterIndex * 0.18)
    const swing = 7.2 + surface * 4.2 + clusterIndex * 0.45
    const duration = 4.1 + clusterIndex * 0.62 + (1 - strength) * 0.9
    const delay = 1.2 + clusterIndex * 2.7
    let blades = ''
    const bladeOrder = Array.from({ length: site.blades + site.shoots }, (_, index) => index)
      .sort((a, b) => a % 3 - b % 3)
    for (const bladeIndex of bladeOrder) {
      const isShoot = bladeIndex >= site.blades
      const depthIndex = bladeIndex % 3
      const depth = (['back', 'middle', 'front'] as const)[depthIndex]
      const maturePosition = bladeIndex - (site.blades - 1) / 2
      const shootSide = clusterIndex === 2 ? -1 : 1
      const position = isShoot ? shootSide * (site.blades * 0.5 + 0.3) : maturePosition
      const offset = position * (5 + site.scale * 0.9) + (r() - 0.5) * 1.5
      const depthScale = depth === 'back' ? 0.84 : depth === 'middle' ? 0.94 : 1
      const maturityScale = isShoot ? 0.54 + r() * 0.08 : 1
      const length = (29 + r() * 15 + (bladeIndex % 2) * 4) * growth * site.scale * depthScale * maturityScale
      const bladeWidth = 3.8 + r() * 1.8
      const bend = direction * (4.8 + strength * 6.3) + (r() - 0.5) * 6.4
      const angle = position * 7 + (r() - 0.5) * 3.5
      const bladeSwing = 4.2 + strength * 4 + (bladeIndex % 3) * 0.7
      const bladeDuration = duration * (0.72 + r() * 0.18)
      const bladeDelay = delay + bladeIndex * 0.8 + r()
      const variant = r() * 2 - 1
      const tipSwing = bladeSwing * (0.42 + r() * 0.16)
      const tipDuration = bladeDuration * (1.17 + r() * 0.12)
      const tipDelay = bladeDelay + 0.55 + r() * 0.75
      const tipId = `${clusterIndex}-${bladeIndex}`
      const tipStyle =
        `--tip-r0:${f1(direction * tipSwing * 0.48)}deg;--tip-r1:${f1(-direction * tipSwing)}deg;` +
        `animation-duration:${f1(tipDuration)}s;animation-delay:-${f1(tipDelay)}s`
      const fill = bladeIndex % 3 === 0 ? theme.plankton[2] : theme.lily
      const opacity = 0.72 + r() * 0.2
      const layerOpacity = isShoot ? 0.82 : depth === 'back' ? 0.68 : depth === 'middle' ? 0.86 : 1
      const ribbon =
        `<path d="${springBladePath(length, bladeWidth, bend)}" fill="${fill}" opacity="${opacity.toFixed(2)}"/>` +
        `<path d="M0 -1 C0 -${f1(length * 0.34)} ${f1(bend * 0.58)} -${f1(length * 0.72)} ${f1(bend)} -${f1(length * 0.92)}" ` +
        `fill="none" stroke="${theme.lilyLight}" stroke-width="0.7" stroke-linecap="round" opacity="0.8"/>` +
        `<g transform="translate(${f1(bend * 0.66)} -${f1(length * 0.7)})">` +
        `<g class="spring-tip" data-spring-tip="${tipId}" style="${tipStyle}">` +
        `<path d="M-${f1(bladeWidth * 0.28)} ${f1(length * 0.07)} Q${f1(bladeWidth * 0.1)} -${f1(length * 0.2)} ${f1(bend * 0.34)} -${f1(length * 0.3)} ` +
        `Q${f1(bend * 0.34 + bladeWidth * 0.4)} -${f1(length * 0.17)} ${f1(bladeWidth * 0.28)} ${f1(length * 0.07)} Z" ` +
        `fill="${fill}" opacity="0.9"/></g></g>`
      const bladeArtwork = site.kind === 'ribbon'
        ? ribbon
        : site.kind === 'pondweed'
          ? springPondweedSprig(
              length * (bladeIndex === Math.floor(site.blades / 2) ? 1.08 : 0.9),
              bend * 0.9,
              theme.plankton[2],
              theme.plankton[3],
              variant,
              tipStyle,
              tipId,
            )
          : springFanwortSprig(
              length * (bladeIndex === Math.floor(site.blades / 2) ? 1.06 : 0.88),
              bend * 0.82,
              theme.plankton[2],
              theme.plankton[3],
              variant,
              tipStyle,
              tipId,
            )
      blades +=
        `<g data-spring-depth="${depth}" data-spring-maturity="${isShoot ? 'shoot' : 'mature'}" ` +
        `opacity="${f1(layerOpacity)}" transform="translate(${f1(offset)} 0) rotate(${f1(angle)})">` +
        `<g class="spring-blade" style="--blade-r0:${f1(-direction * bladeSwing * 0.45)}deg;` +
        `--blade-r1:${f1(direction * bladeSwing)}deg;animation-duration:${f1(bladeDuration)}s;animation-delay:-${f1(bladeDelay)}s">` +
        bladeArtwork +
        `</g></g>`
    }
    return (
      `<g data-spring-cluster="${clusterIndex}" data-spring-kind="${site.kind}" transform="translate(${f1(site.x)} ${f1(site.y)}) rotate(${site.rotation})">` +
      `<path data-spring-substrate="${clusterIndex}" d="M-${f1(16 * site.scale)} 2.6 ` +
      `Q-${f1(8 * site.scale)} -3.2 ${f1(1.5 * site.scale)} -1.5 Q${f1(10 * site.scale)} -2.8 ${f1(17 * site.scale)} 2.4 ` +
      `Q${f1(4 * site.scale)} ${f1(6.2 * site.scale)} -${f1(16 * site.scale)} 2.6 Z" ` +
      `fill="${theme.pebbles[0]}" opacity="0.48"/>` +
      `<ellipse cx="1.8" cy="2.4" rx="${f1(15 * site.scale)}" ry="${f1(3.7 * site.scale)}" fill="rgba(0,20,25,0.17)"/>` +
      `<circle cx="-${f1(7.2 * site.scale)}" cy="1.2" r="${f1(2.2 * site.scale)}" fill="${theme.pebbles[1]}" opacity="0.78"/>` +
      `<circle cx="${f1(7.8 * site.scale)}" cy="1.5" r="${f1(2.7 * site.scale)}" fill="${theme.pebbles[2]}" opacity="0.72"/>` +
      `<g class="spring-plant" data-plant-current="${direction}" ` +
      `style="--plant-r0:${f1(bias - swing)}deg;--plant-r1:${f1(bias + swing)}deg;` +
      `animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s">` +
      blades +
      `</g>` +
      `<path d="M-${f1(10 * site.scale)} 1.4 Q0 -2.8 ${f1(10 * site.scale)} 1.4 Q0 4.2 -${f1(10 * site.scale)} 1.4 Z" ` +
      `data-spring-root="${clusterIndex}" fill="${theme.plankton[1]}" opacity="0.76"/>` +
      `<path data-spring-foreground="${clusterIndex}" d="M-${f1(12 * site.scale)} 2.6 ` +
      `Q-${f1(4 * site.scale)} 0.8 ${f1(2 * site.scale)} 2.1 Q${f1(8 * site.scale)} 0.6 ${f1(13 * site.scale)} 3.1" ` +
      `fill="none" stroke="${theme.pebbles[2]}" stroke-width="${f1(1.5 * site.scale)}" stroke-linecap="round" opacity="0.62"/>` +
      `</g>`
    )
  }).join('')

  let bubbles = ''
  for (let index = 0; index < 6; index++) {
    const source = sites[index % sites.length]
    const x = source.x + (r() - 0.5) * 18
    const y = source.y - 1 - r() * 4
    const rise = 27 + r() * 25
    const drift = direction * (4 + strength * 7) + (r() - 0.5) * 4
    const duration = 7.2 + r() * 4.4
    const delay = r() * duration
    const radius = 1.25 + r() * 1.25
    bubbles +=
      `<g transform="translate(${f1(x)} ${f1(y)})">` +
      `<g class="spring-bubble" data-spring-bubble="${index}" ` +
      `style="--bubble-x:${f1(drift)}px;--bubble-y:-${f1(rise)}px;animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s">` +
      `<circle r="${f1(radius)}" fill="none" stroke="${theme.ripple}" stroke-width="0.72" opacity="0.7"/>` +
      `<circle cx="-${f1(radius * 0.28)}" cy="-${f1(radius * 0.28)}" r="${f1(Math.max(0.28, radius * 0.2))}" fill="${theme.sheen}" opacity="0.68"/>` +
      `</g></g>`
  }

  const opacity = Math.min(0.94, intensity * 0.94)
  const bubbleOpacity = opacity * (0.52 + clamp01(daylight) * 0.48)
  return (
    `<g data-seasonal-part="spring-growth" data-spring-growth="${intensity.toFixed(3)}" opacity="${f1(opacity)}">` +
    `<g data-spring-part="water-plants">${clusters}</g>` +
    `<g data-spring-part="oxygen-bubbles" opacity="${f1(bubbleOpacity)}">${bubbles}</g>` +
    `</g>`
  )
}

function lotusState(openness: number) {
  return openness >= 0.72 ? 'open' : openness >= 0.3 ? 'opening' : 'sleeping'
}

function lotusPetal(radius: number, halfWidth: number): string {
  return (
    `M0 0 ` +
    `C${f1(radius * 0.2)} -${f1(halfWidth)} ${f1(radius * 0.67)} -${f1(halfWidth * 0.94)} ${f1(radius)} 0 ` +
    `C${f1(radius * 0.67)} ${f1(halfWidth * 0.94)} ${f1(radius * 0.2)} ${f1(halfWidth)} 0 0 Z`
  )
}

interface LotusVariation {
  id: number
  seed: number
  rotation: number
  anchorX: number
  anchorY: number
  budLean: number
}

function lotusVariation(seed: number, index: number): LotusVariation {
  const wave = (salt: number) => Math.sin((seed + salt) * (index + 1.73) * 19.173)
  return {
    id: index * 1000 + Math.round(seed * 999),
    seed,
    rotation: wave(0.31) * 9,
    anchorX: wave(0.67) * 0.6,
    anchorY: wave(1.13) * 0.38,
    budLean: wave(1.71) * 7,
  }
}

function lotusDetail(variation: LotusVariation, index: number, salt: number): number {
  return Math.sin((variation.seed + salt) * (index + 1.41) * 23.371)
}

function openLotus(theme: Theme, radius: number, delay = 0, variation = lotusVariation(0.5, 0)): string {
  const outerSpecs = [
    [-8, 1.12, 0.43], [43, 0.9, 0.46], [92, 1.07, 0.42], [145, 0.92, 0.45],
    [198, 1.1, 0.43], [252, 0.9, 0.46], [308, 1.02, 0.43],
  ]
  const innerSpecs = [[18, 0.72], [86, 0.64], [158, 0.7], [231, 0.63], [304, 0.7]]
  const outer = outerSpecs
    .map(([angle, length, width], index) => {
      const angleJitter = lotusDetail(variation, index, 0.37) * 4.2
      const lengthJitter = 1 + lotusDetail(variation, index, 0.89) * 0.065
      const widthJitter = 1 + lotusDetail(variation, index, 1.43) * 0.05
      return (
        `<path d="${lotusPetal(radius * length * lengthJitter, radius * width * widthJitter)}" ` +
        `transform="rotate(${f1(angle + angleJitter)})" fill="${theme.lotusOuter}" ` +
        `opacity="${index % 2 === 0 ? '0.94' : '0.84'}" stroke="${theme.lotusInner}" stroke-width="0.28" stroke-opacity="0.5"/>`
      )
    })
    .join('')
  const inner = innerSpecs
    .map(([angle, length], index) => {
      const angleJitter = lotusDetail(variation, index, 2.11) * 5.2
      const lengthJitter = 1 + lotusDetail(variation, index, 2.63) * 0.075
      return (
        `<path d="${lotusPetal(radius * length * lengthJitter, radius * (0.35 + lotusDetail(variation, index, 3.07) * 0.018))}" ` +
        `transform="rotate(${f1(angle + angleJitter)})" fill="${theme.lotusInner}" ` +
        `opacity="${index % 2 === 0 ? '0.98' : '0.9'}"/>`
      )
    })
    .join('')
  const stamenCount = variation.seed > 0.55 ? 6 : 5
  const stamens = Array.from({ length: stamenCount }, (_, index) => {
    const angle = (index / stamenCount) * Math.PI * 2 - 0.2 + variation.rotation * 0.012
    return `<circle cx="${f1(Math.cos(angle) * radius * 0.12)}" cy="${f1(Math.sin(angle) * radius * 0.09)}" r="${f1(radius * 0.032)}" fill="${theme.lotusInner}" opacity="0.82"/>`
  }).join('')
  const heartWidth = radius * (0.21 + lotusDetail(variation, 0, 3.71) * 0.012)
  const heartHeight = radius * (0.165 + lotusDetail(variation, 1, 4.03) * 0.01)
  return (
    `<g class="bloom lotus-bloom" data-lotus-petal-layout="lobed" data-lotus-variant="${variation.id}" ` +
    `style="animation-delay:-${f1(delay)}s">` +
    outer + inner +
    `<ellipse rx="${f1(heartWidth)}" ry="${f1(heartHeight)}" transform="rotate(${f1(-12 + variation.rotation * 0.35)})" ` +
    `fill="${theme.lotusHeart}" opacity="0.96"/>` +
    stamens +
    `</g>`
  )
}

function closedLotusBud(theme: Theme, radius: number, variation = lotusVariation(0.5, 0)): string {
  const budPetal = (height: number, halfWidth: number, lean: number) =>
    `M0 ${f1(radius * 0.48)} C-${f1(halfWidth)} ${f1(radius * 0.06)} ${f1(lean - halfWidth * 0.72)} -${f1(height * 0.7)} ${f1(lean)} -${f1(height)} ` +
    `C${f1(lean + halfWidth * 0.72)} -${f1(height * 0.7)} ${f1(halfWidth)} ${f1(radius * 0.06)} 0 ${f1(radius * 0.48)} Z`
  return (
    `<path d="M-${f1(radius * 0.82)} ${f1(radius * 0.4)} Q0 ${f1(radius * 0.8)} ${f1(radius * 0.82)} ${f1(radius * 0.4)}" ` +
    `fill="none" stroke="rgba(0,20,25,0.18)" stroke-width="${f1(radius * 0.55)}" stroke-linecap="round"/>` +
    `<g data-lotus-bud-layout="folded-petals" transform="translate(0 ${f1(radius * 0.1)}) rotate(${f1(-9 + variation.budLean)})">` +
    `<path d="${budPetal(radius * 0.83, radius * 0.4, -radius * 0.18)}" transform="translate(-${f1(radius * 0.22)} 0) rotate(-13)" fill="${theme.lotusOuter}" opacity="0.84"/>` +
    `<path d="${budPetal(radius * 0.78, radius * 0.38, radius * 0.16)}" transform="translate(${f1(radius * 0.22)} 0) rotate(13)" fill="${theme.lotusOuter}" opacity="0.8"/>` +
    `<path d="${budPetal(radius * 1.06, radius * 0.4, 0)}" fill="${theme.lotusInner}" opacity="0.96" ` +
    `stroke="${theme.lotusOuter}" stroke-width="0.34" stroke-opacity="0.66"/>` +
    `<path d="M0 ${f1(radius * 0.42)} C-${f1(radius * 0.18)} -${f1(radius * 0.05)} -${f1(radius * 0.11)} -${f1(radius * 0.5)} 0 -${f1(radius * 0.66)}" ` +
    `fill="none" stroke="${theme.lotusOuter}" stroke-width="0.72" stroke-linecap="round" opacity="0.72"/>` +
    `</g>`
  )
}

function smallLotus(
  theme: Theme,
  scale: number,
  delay: number,
  openness: number,
  variation: LotusVariation,
): string {
  const open = clamp01(openness)
  const openOpacity = clamp01((open - 0.18) / 0.55)
  const budOpacity = 1 - clamp01((open - 0.22) / 0.55)
  const openScaleX = 0.56 + open * 0.44
  const openScaleY = 0.46 + open * 0.54
  return (
    `<g data-lotus-state="${lotusState(open)}" data-lotus-openness="${open.toFixed(3)}" ` +
    `data-lotus-rotation="${f1(variation.rotation)}" transform="scale(${f1(scale)})">` +
    `<path class="lotus-water-shadow" d="M-7.4 2.4 Q0 6.1 7.4 2.4 Q0 4.4 -7.4 2.4 Z" fill="rgba(0,20,25,0.16)"/>` +
    `<path class="lotus-waterline" d="M-7.4 2.2 Q0 5.6 7.4 2.2" fill="none" stroke="${theme.lilyLight}" stroke-width="0.65" stroke-linecap="round" opacity="0.56"/>` +
    `<g data-lotus-flower-anchor="offset" transform="translate(${f1(-2.4 + variation.anchorX)} ${f1(-2 + variation.anchorY)})">` +
    `<g class="lotus-open-stage" opacity="${openOpacity.toFixed(3)}" transform="scale(${f1(openScaleX)} ${f1(openScaleY)})">` +
    `<g transform="rotate(${f1(variation.rotation)})">` +
    openLotus(theme, 9.8, delay, variation) +
    `</g>` +
    `</g>` +
    `<g class="summer-lotus-bud" data-lotus-form="closed-bud" data-lotus-view="top-down-folded" opacity="${(budOpacity * 0.88).toFixed(3)}" style="animation-delay:-${f1(delay * 0.6)}s">` +
    closedLotusBud(theme, 6.8, variation) +
    `</g>` +
    `</g>` +
    `</g>`
  )
}

interface LotusDrift {
  currentDirection: number
  currentStrength: number
  surfaceActivity: number
  daylight: number
  index: number
  intensity?: number
}

function lotusDriftAttributes(motion: LotusDrift): string {
  const direction = motion.currentDirection < 0 ? -1 : 1
  const strength = clamp01(motion.currentStrength)
  const surface = clamp01(motion.surfaceActivity)
  const daylight = clamp01(motion.daylight)
  const intensity = clamp01(motion.intensity ?? 1)
  const daylightFactor = 0.62 + daylight * 0.38
  const amplitude = (2.6 + strength * 2.8) * (0.78 + surface * 0.22) * daylightFactor * intensity
  const vertical = (0.82 + surface * 0.92) * (0.7 + daylight * 0.3) * intensity
  const x0 = -direction * amplitude * 0.38
  const x1 = direction * amplitude * 0.2
  const x2 = direction * amplitude
  const y0 = -vertical * (motion.index % 2 === 0 ? 0.28 : 0.12)
  const y1 = vertical * (motion.index % 2 === 0 ? 0.74 : 1)
  const y2 = -vertical * (motion.index % 2 === 0 ? 0.44 : 0.62)
  const tilt = direction * (0.65 + surface * 0.65) * intensity
  const duration = 8.4 + motion.index * 1.3 + (1 - strength) * 2.2
  const delay = 1.3 + motion.index * 3.1
  return (
    `class="summer-lotus-drift" data-lotus-motion="current-drift" ` +
    `data-lotus-current="${direction}" data-lotus-drift-x="${amplitude.toFixed(2)}" ` +
    `style="--lotus-x0:${f1(x0)}px;--lotus-y0:${f1(y0)}px;--lotus-r0:${f1(-tilt * 0.6)}deg;` +
    `--lotus-x1:${f1(x1)}px;--lotus-y1:${f1(y1)}px;--lotus-r1:${f1(tilt * 0.15)}deg;` +
    `--lotus-x2:${f1(x2)}px;--lotus-y2:${f1(y2)}px;--lotus-r2:${f1(tilt)}deg;` +
    `animation-duration:${f1(duration)}s;animation-delay:-${f1(delay)}s"`
  )
}

function summerBloomSites(width: number, seed: string) {
  const pads = lilyPadLayout(width, seed)
  const r = rng(`lotus-variation:${seed}`)
  return [
    { x: pads[0].x + 1, y: pads[0].y - 2, scale: 0.82, variation: lotusVariation(r(), 0) },
    { x: pads[1].x + 2, y: pads[1].y - 2, scale: 0.8, variation: lotusVariation(r(), 1) },
    { x: pads[2].x - 4, y: pads[2].y + 1, scale: 1.04, variation: lotusVariation(r(), 2) },
  ]
}

export function summerBlooms(
  width: number,
  theme: Theme,
  seed: string,
  intensity: number,
  openness = 1,
  currentDirection = 1,
  currentStrength = 0.5,
  surfaceActivity = 1,
  daylight = 1,
): string {
  if (intensity < 0.08) return ''
  const blooms = summerBloomSites(width, seed)
    .map(({ x, y, scale, variation }, index) =>
      `<g transform="translate(${f1(x)} ${f1(y)})">` +
      `<g ${lotusDriftAttributes({ currentDirection, currentStrength, surfaceActivity, daylight, index })}>` +
      smallLotus(theme, scale, index * 1.7, openness, variation) +
      `</g></g>`,
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
  const nightColors = ['#a95143', '#b8733e', '#98743d']
  const dayColors = ['#d85c42', '#e5833d', '#c69a45']
  const colors = nightColors.map((color, index) => mixColor(color, dayColors[index], theme.lightLevel))
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
  const fill = mixColor('rgba(157,211,225,0.38)', 'rgba(229,247,250,0.82)', theme.lightLevel)
  const rim = mixColor('rgba(191,236,245,0.55)', 'rgba(255,255,255,0.9)', theme.lightLevel)
  const snow = mixColor('rgba(225,246,250,0.5)', 'rgba(255,255,255,0.9)', theme.lightLevel)
  const crack = mixColor('rgba(211,244,250,0.3)', 'rgba(74,137,154,0.32)', theme.lightLevel)
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
  motion?: Omit<LotusDrift, 'index'>,
): string {
  const y = 24 + r() * 6
  const variation = lotusVariation((y - 24) / 6, 3)
  const open = clamp01(openness)
  const openOpacity = clamp01((open - 0.18) / 0.55)
  const budOpacity = 1 - clamp01((open - 0.22) / 0.55)
  const openScaleX = 0.56 + open * 0.44
  const openScaleY = 0.46 + open * 0.54
  const padPath = 'M9.8 -8 C13.2 -3.2 12.6 4.6 7.8 9.4 C2.1 14.1 -7.1 12.6 -11.4 6.3 C-15.1 0.8 -12.2 -7.6 -5.5 -11.2 C0.1 -14.1 6.5 -12.2 9.8 -8 L0 0 Z'
  const pondLotus =
    `<ellipse cx="2.5" cy="3.5" rx="13" ry="12" fill="rgba(0,20,25,0.2)"/>` +
    `<g data-lotus-pad="notched">` +
    `<path d="${padPath}" fill="${theme.lily}" opacity="0.9"/>` +
    `<path d="${padPath}" fill="none" stroke="${theme.lilyLight}" stroke-width="1.4" opacity="0.8"/>` +
    `<path d="M0 0 L8.8 -7.2 M0 0 L-8.3 2 M0 0 L-2.2 9" ` +
    `fill="none" stroke="${theme.lilyVein}" stroke-width="0.9" opacity="0.72"/>` +
    `</g>` +
    `<g data-lotus-state="${lotusState(open)}" data-lotus-openness="${open.toFixed(3)}">` +
    `<g data-lotus-flower-anchor="offset" transform="translate(${f1(-3 + variation.anchorX)} ${f1(-2 + variation.anchorY)})">` +
    `<g class="lotus-open-stage" opacity="${openOpacity.toFixed(3)}" transform="scale(${f1(openScaleX)} ${f1(openScaleY)})">` +
    `<g transform="rotate(${f1(variation.rotation)})">` +
    openLotus(theme, 9.6, 0, variation) +
    `</g>` +
    `</g>` +
    `<g class="lotus-bud" data-lotus-form="closed-bud" data-lotus-view="top-down-folded" opacity="${budOpacity.toFixed(3)}">` +
    closedLotusBud(theme, 7, variation) +
    `</g>` +
    `</g>` +
    `</g>`
  const floatingLotus = motion
    ? `<g ${lotusDriftAttributes({ ...motion, index: 3 })}>${pondLotus}</g>`
    : pondLotus
  return (
    `<g transform="translate(${f1(x)} ${f1(y)})">` +
    floatingLotus +
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
