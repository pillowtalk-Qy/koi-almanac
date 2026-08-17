import { rng } from '../prng'
import { f2 } from '../util'
import type { FishPlan, Point } from '../types'
import type { Theme } from './palette'

function radiusProfile(n: number, peakAt: number, nose: number, peak: number, tip: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(i <= peakAt ? nose + ((peak - nose) * i) / peakAt : peak - ((peak - tip) * (i - peakAt)) / (n - 1 - peakAt))
  }
  return out
}

export function fishPointAt(f: FishPlan, time: number, duration: number): Point {
  const t = ((time % duration) + duration) % duration
  const wps = f.waypoints
  let upper = 1
  while (upper < wps.length && wps[upper].t < t) upper++
  const b = wps[Math.min(upper, wps.length - 1)]
  const a = wps[Math.max(0, upper - 1)]
  const span = b.t - a.t
  const mix = span <= 0 ? 0 : (t - a.t) / span
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix }
}

export function fishStaticTrail(f: FishPlan, staticTime: number, duration: number): Point[] {
  const isKoi = f.species === 'koi'
  const count = isKoi ? 22 : 11
  const lag = isKoi ? 0.05 : 0.042
  return Array.from({ length: count }, (_, index) => fishPointAt(f, staticTime - index * lag, duration))
}

const positionStyle = (point: Point, delay?: number) =>
  ` style="transform:translate(${f2(point.x)}px,${f2(point.y)}px)${delay === undefined ? '' : `;animation-delay:${f2(delay)}s`}"`

export function fishSVG(
  f: FishPlan,
  theme: Theme,
  staticTime: number,
  duration: number,
  animationDuration = duration,
): string {
  const rf = rng(`fish:${f.key}`)
  const isKoi = f.species === 'koi'
  const cls = `f${f.id}`

  const N = isKoi ? 22 : 11
  const lag = isKoi ? 0.05 : 0.042
  const radii = isKoi ? radiusProfile(N, 4, 4.2, 6.5, 1.5) : radiusProfile(N, 3, 2.2, 3.2, 0.9)
  const staticTrail = fishStaticTrail(f, staticTime, duration)
  const delayForLag = (trailLag: number) =>
    trailLag <= 0 ? undefined : -(animationDuration - trailLag * (animationDuration / duration))

  let base: string
  let band: string
  let fin: string
  let eye: string
  if (isKoi) {
    const v = theme.koi[Math.floor(rf() * theme.koi.length)]
    base = v.base
    band = v.patch
    fin = v.fin
    eye = v.eye
  } else {
    base = theme.minnow[f.id % theme.minnow.length]
    band = base
    fin = base
    eye = theme.key === 'dark' ? theme.waterTop : '#26221e'
  }

  const bandStart = 5 + Math.floor(rf() * 3)
  const bandEnd = bandStart + 3 + Math.floor(rf() * 3)
  const band2 = isKoi && rf() < 0.45
  const b2Start = 14 + Math.floor(rf() * 2)

  const segFill = (i: number) => {
    if (!isKoi) return base
    if (i >= bandStart && i < bandEnd) return band
    if (band2 && i >= b2Start && i < b2Start + 3) return band
    return base
  }
  const segOpacity = (i: number) => Math.min(0.94, 0.86 * Math.pow(1 - i / (N - 1), 1.05) + 0.15)

  const ridge = theme.key === 'dark' ? '#e6fbff' : '#0a2430'
  const ridgeOp = theme.key === 'dark' ? 0.17 : 0.13
  let trail = ''
  for (let i = N - 1; i >= 0; i--) {
    const d = positionStyle(staticTrail[i], delayForLag(i * lag))
    trail += `<circle class="${cls}"${d} r="${f2(radii[i] * f.size)}" fill="${segFill(i)}" fill-opacity="${f2(segOpacity(i))}"/>`
    if (isKoi && i >= 2 && i <= 13) {
      trail += `<circle class="${cls}"${d} r="${f2(radii[i] * f.size * 0.42)}" fill="${ridge}" fill-opacity="${f2(ridgeOp)}"/>`
    }
  }

  const shoulder = f2(radii[4] * f.size + 1.6)
  const pecs = isKoi
    ? `<g class="${cls}"${positionStyle(fishPointAt(f, staticTime - 3 * lag, duration), delayForLag(3 * lag))}>` +
      `<ellipse class="pt" cx="0" cy="-${shoulder}" rx="${f2(3.1 * f.size)}" ry="${f2(1.4 * f.size)}" fill="${fin}"/>` +
      `<ellipse class="pb" cx="0" cy="${shoulder}" rx="${f2(3.1 * f.size)}" ry="${f2(1.4 * f.size)}" fill="${fin}"/>` +
      `</g>`
    : ''

  const tailFin =
    `<g class="${cls}"${positionStyle(
      fishPointAt(f, staticTime - (N - 0.3) * lag, duration),
      delayForLag((N - 0.3) * lag),
    )}>` +
    `<ellipse class="tf" rx="${f2((isKoi ? 3.8 : 2) * f.size)}" ry="${f2((isKoi ? 1.5 : 0.9) * f.size)}" fill="${fin}" fill-opacity="0.8"/>` +
    `</g>`

  const eo = f2(2.3 * f.size)
  const er = f2((isKoi ? 1.05 : 0.6) * f.size)
  const glint = f2(er * 0.38)
  const eyes =
    `<g class="${cls}"${positionStyle(staticTrail[0])}>` +
    `<circle cy="-${eo}" r="${er}" fill="${eye}"/><circle cy="${eo}" r="${er}" fill="${eye}"/>` +
    `<circle cx="${glint}" cy="-${f2(eo + glint * 0.6)}" r="${glint}" fill="#ffffff" fill-opacity="0.85"/>` +
    `<circle cx="${glint}" cy="${f2(eo - glint * 0.6)}" r="${glint}" fill="#ffffff" fill-opacity="0.85"/>` +
    `</g>`

  return `${pecs}${tailFin}<g filter="url(#fx)">${trail}</g>${eyes}`
}
