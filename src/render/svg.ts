import { LAYOUT, cellCenter, svgWidth } from '../layout'
import { iceFloeLayout, iceFloeSideContact, pondObstacleLayout } from '../ecology'
import type { PondEnvironment } from '../environment'
import { longestGap, longestStreak } from '../planner'
import { rng } from '../prng'
import type { PondProvenance } from '../state'
import type { Grid, Plan, Waypoint } from '../types'
import { f1 } from '../util'
import {
  SOFT_FILTER,
  ambientRipples,
  autumnMapleLeaves,
  caustics,
  deepShade,
  directionalWaterLight,
  floorBlotches,
  godRays,
  lilyPads,
  lotus,
  moonWaterLight,
  motes,
  pebbles,
  springWaterPlants,
  summerFireflies,
  summerBlooms,
  surfaceSheen,
  turtle,
  waterCurrents,
  winterIce,
  winterSnowfall,
} from './decor'
import { fishPointAt, fishStaticTrail, fishSVG } from './fish'
import type { Theme } from './palette'

const PLANKTON_R = [0, 2.1, 2.8, 3.5, 4.2]
const TURTLE_STREAK = 30
const LOTUS_GAP = 21
const smoothAmount = (edge0: number, edge1: number, value: number) => {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return amount * amount * (3 - 2 * amount)
}

export interface RenderMeta {
  plankton: number
  fish: number
  duration: number
  turtle: boolean
  lotus: boolean
  bytes: number
}

export interface RenderContext {
  provenance?: PondProvenance
  highlightedCells?: ReadonlySet<number>
  environment?: PondEnvironment
  staticTime?: number
}

const pct = (t: number, duration: number) => ((t / duration) * 100).toFixed(2)

const bucketOf = (t: number, duration: number) => {
  const b = Math.round((t / duration) * 200) / 2
  return Math.min(90, Math.max(0.5, b))
}
const bucketId = (b: number) => b.toFixed(1).replace('.', '_')

function fishKeyframes(
  plan: Plan,
  animationDuration: number,
): string {
  let css = ''
  for (const f of plan.fishes) {
    const wps = f.waypoints.map(wp => ({ ...wp }))
    for (let pass = 0; pass < 2; pass++) {
      const src = wps.map(wp => ({ x: wp.x, y: wp.y }))
      for (let i = 1; i < wps.length - 1; i++) {
        wps[i].x = (src[i - 1].x + 2 * src[i].x + src[i + 1].x) / 4
        wps[i].y = (src[i - 1].y + 2 * src[i].y + src[i + 1].y) / 4
      }
    }

    const kept: Waypoint[] = []
    let lastKept: Waypoint | null = null
    let lastHeading: number | null = null
    wps.forEach((wp, i) => {
      if (i === 0 || i === wps.length - 1) {
        kept.push(wp)
        lastKept = wp
        lastHeading = null
        return
      }
      const prev = wps[i - 1]
      const heading = Math.atan2(wp.y - prev.y, wp.x - prev.x)
      let turn = lastHeading === null ? Infinity : Math.abs(heading - lastHeading)
      if (turn > Math.PI) turn = Math.PI * 2 - turn
      if (turn > 0.04 || wp.t - (lastKept as Waypoint).t > 0.3) {
        kept.push(wp)
        lastKept = wp
        lastHeading = heading
      }
    })

    const entries: string[] = []
    let lastPct = -1
    kept.forEach(wp => {
      const p = pct(wp.t, plan.duration)
      if (Number(p) <= lastPct || Number(p) >= 100) return
      lastPct = Number(p)
      entries.push(
        `${p}%{transform:translate(${wp.x.toFixed(1)}px,${wp.y.toFixed(1)}px);opacity:${(0.92 + wp.satiety * 0.08).toFixed(3)}}`,
      )
    })
    const home = wps[wps.length - 1]
    entries.push(`100%{transform:translate(${home.x.toFixed(1)}px,${home.y.toFixed(1)}px);opacity:0.92}`)
    css += `@keyframes fp${f.id}{${entries.join('')}}.f${f.id}{animation:fp${f.id} ${animationDuration}s linear infinite}`
  }
  return css
}

export function bestStaticTime(plan: Plan, width: number, seed: string, environment?: PondEnvironment): number {
  const obstacles = pondObstacleLayout(width, seed, environment)
  let best = { score: -Infinity, time: plan.duration * 0.5 }

  for (let index = 0; index <= 72; index++) {
    const time = plan.duration * (0.08 + (index / 72) * 0.74)
    const trails = plan.fishes.map(fish => fishStaticTrail(fish, time, plan.duration))
    let score = 0

    trails.forEach((trail, fishIndex) => {
      for (const point of trail) {
        const edge = Math.min(point.x, width - point.x, point.y, LAYOUT.height - point.y)
        score += Math.min(42, edge) * 0.05
        for (const obstacle of obstacles) {
          const clearance = Math.hypot(point.x - obstacle.x, point.y - obstacle.y) - obstacle.radius
          score += clearance < 10 ? (clearance - 10) * 8 : Math.min(28, clearance) * 0.015
        }
      }
      const head = trail[0]
      score -= Math.abs(head.x - width * 0.5) * 0.003
      score -= Math.abs(head.y - LAYOUT.height * 0.52) * 0.012

      for (let otherIndex = fishIndex + 1; otherIndex < plan.fishes.length; otherIndex++) {
        const other = fishPointAt(plan.fishes[otherIndex], time, plan.duration)
        const separation = Math.hypot(head.x - other.x, head.y - other.y)
        if (separation < 38) score -= (38 - separation) * 3
      }
    })

    if (score > best.score) best = { score, time }
  }

  return best.time
}

interface TurtleChoreography {
  css: string
  effects: string
  delay: number
  iceAction: number
  checkpoints: null | {
    entry: number
    mount: number
    walk: number
    brace: number
    air: number
    impact: number
    splash: number
    submerge: number
  }
}

function turtleChoreography(
  width: number,
  turtleY: number,
  seed: string,
  duration: number,
  ripple: string,
  environment?: PondEnvironment,
): TurtleChoreography {
  const floe = environment && environment.iceCoverage >= 0.18
    ? iceFloeLayout(width, seed, environment.iceCoverage)[1]
    : undefined
  if (!floe) {
    return {
      css:
        `@keyframes turtle{0%{transform:translate(-40px,${turtleY}px)}100%{transform:translate(${width + 40}px,${turtleY}px)}}` +
        `@keyframes turtle-body{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-1px) rotate(0.8deg)}}` +
        `@keyframes turtle-shadow{0%,100%{opacity:0.18;transform:scale(1)}50%{opacity:0.14;transform:scale(0.94)}}` +
        `.snow-track{opacity:0}`,
      effects: '',
      delay: 0,
      iceAction: 0,
      checkpoints: null,
    }
  }
  const iceAction = smoothAmount(0.18, 0.72, environment?.iceCoverage ?? 0)
  const transitY = turtleY - 6 * iceAction
  const percentAt = (x: number) => Math.max(0, Math.min(100, ((x + 40) / (width + 80)) * 100))
  const percent = (value: number) => value.toFixed(2)
  const entry = iceFloeSideContact(floe, seed, 1, 'left')
  const exit = iceFloeSideContact(floe, seed, 1, 'right')
  const alongNormal = (
    contact: typeof entry,
    distance: number,
  ) => ({ x: contact.x + contact.normalX * distance, y: contact.y + contact.normalY * distance })
  const waterPoint = (contact: typeof entry, distance: number, maxY: number) => {
    const point = alongNormal(contact, distance)
    return { ...point, y: Math.max(30, Math.min(maxY, point.y)) }
  }
  const clampHeading = (value: number) => Math.max(-12, Math.min(12, value))
  const heading = (x: number, y: number) => clampHeading((Math.atan2(y, x) * 180) / Math.PI)
  const poseAngle = (value: number) => f1(Math.max(-20, Math.min(20, value)))
  const withIceAction = (point: { x: number; y: number }) => ({
    x: point.x,
    y: turtleY + (point.y - turtleY) * iceAction,
  })
  const entryApproach = withIceAction(waterPoint(entry, 34, turtleY - 6))
  const entryContact = withIceAction(waterPoint(entry, 16, turtleY - 2))
  const entryLift = withIceAction(waterPoint(entry, 7, turtleY - 4))
  const entryMount = withIceAction(alongNormal(entry, -10))
  const entryWalk = withIceAction(alongNormal(entry, -24))
  const exitBrace = withIceAction(alongNormal(exit, -25))
  const exitPush = withIceAction(alongNormal(exit, -11))
  const exitAir = withIceAction(waterPoint(exit, 2, turtleY - 6))
  const exitImpact = withIceAction(waterPoint(exit, 12, turtleY - 2))
  const exitSplash = withIceAction(waterPoint(exit, 19, turtleY - 4))
  const exitSubmergeBase = alongNormal(exit, 27)
  const exitSubmerge = withIceAction({
    x: exitSubmergeBase.x,
    y: Math.min(turtleY + 1, Math.max(exitSplash.y + 4, exitSubmergeBase.y)),
  })
  const exitDepart = withIceAction(waterPoint(exit, 43, turtleY - 6))
  const entryHeading = heading(-entry.normalX, -entry.normalY)
  const walkHeading = heading(exitBrace.x - entryWalk.x, exitBrace.y - entryWalk.y)
  const exitHeading = heading(exit.normalX, exit.normalY)
  const approach = percentAt(entryApproach.x)
  const contact = Math.max(approach + 1, percentAt(entryContact.x))
  const lift = contact + 1.8
  const mount = contact + 4.6
  const walkStart = contact + 6.2
  const middle = Math.max(walkStart + 1, percentAt(floe.x))
  const brace = Math.max(middle + 1, percentAt(exitBrace.x))
  const push = brace + 1.5
  const air = push + 2.2
  const impact = push + 4.6
  const splash = impact + 1
  const submerge = splash + 1.45
  const depart = Math.max(submerge + 1.8, percentAt(exitDepart.x))
  const initialX = Math.max(48, width * 0.07)
  const initialDelay = (percentAt(initialX) / 100) * duration * iceAction
  const delayCSS = `-${f1(initialDelay)}s`
  const frame = (at: number, x: number, y: number, easing = 'linear') =>
    `${percent(at)}%{transform:translate(${f1(x)}px,${f1(y)}px);animation-timing-function:${easing}}`
  const bodyFrame = (at: number, transform: string) => `${percent(at)}%{transform:${transform}}`
  const bodyPose = (y: number, angle: number, scaleX = 1, scaleY?: number) => {
    const x = 1 + (scaleX - 1) * iceAction
    const scaleValue = (value: number) => String(Number(value.toFixed(2)))
    const scale = scaleY === undefined
      ? `scale(${scaleValue(x)})`
      : `scale(${scaleValue(x)},${scaleValue(1 + (scaleY - 1) * iceAction)})`
    return `translateY(${f1(y * iceAction)}px) rotate(${poseAngle(angle * iceAction)}deg) ${scale}`
  }
  const step1 = walkStart + (brace - walkStart) * 0.24
  const step2 = walkStart + (brace - walkStart) * 0.49
  const step3 = walkStart + (brace - walkStart) * 0.74
  const motion =
    `@keyframes turtle{` +
    `0%{transform:translate(-40px,${transitY}px)}` +
    frame(approach, entryApproach.x, entryApproach.y) +
    frame(contact, entryContact.x, entryContact.y, 'ease-out') +
    frame(lift, entryLift.x, entryLift.y, 'ease-in-out') +
    frame(mount, entryMount.x, entryMount.y, 'ease-out') +
    frame(walkStart, entryWalk.x, entryWalk.y, 'linear') +
    frame(middle, floe.x, turtleY + (floe.y - turtleY) * iceAction) +
    frame(brace, exitBrace.x, exitBrace.y, 'linear') +
    frame(push, exitPush.x, exitPush.y, 'ease-in') +
    frame(air, exitAir.x, exitAir.y, 'ease-out') +
    frame(impact, exitImpact.x, exitImpact.y, 'ease-in') +
    frame(splash, exitSplash.x, exitSplash.y, 'ease-out') +
    frame(submerge, exitSubmerge.x, exitSubmerge.y, 'ease-in-out') +
    frame(depart, exitDepart.x, exitDepart.y) +
    `100%{transform:translate(${width + 40}px,${transitY}px)}}`
  const body =
    `@keyframes turtle-body{` +
    `0%,${percent(approach)}%{transform:translateY(0) rotate(0) scale(1)}` +
    bodyFrame(contact, bodyPose(1, entryHeading, 0.98, 1.03)) +
    bodyFrame(lift, bodyPose(-1, entryHeading - 5, 1.05, 0.92)) +
    bodyFrame(mount, bodyPose(-3, entryHeading + 10, 0.88, 1.08)) +
    bodyFrame(walkStart, bodyPose(0, walkHeading - 1, 1.02)) +
    bodyFrame(step1, bodyPose(-1.4, walkHeading + 1.4, 1.03)) +
    bodyFrame(step2, bodyPose(0, walkHeading - 1.2, 1.02)) +
    bodyFrame(step3, bodyPose(-1.2, walkHeading + 1.2, 1.03)) +
    bodyFrame(brace, bodyPose(2, exitHeading + 8, 1.06, 0.92)) +
    bodyFrame(push, bodyPose(3, exitHeading + 14, 1.1, 0.88)) +
    bodyFrame(air, bodyPose(-6, exitHeading - 16, 0.88, 1.12)) +
    bodyFrame(impact, bodyPose(2, exitHeading + 14, 1.12, 0.86)) +
    bodyFrame(splash, bodyPose(0, exitHeading + 4, 1.05)) +
    bodyFrame(submerge, bodyPose(2, exitHeading - 2, 1.08, 0.86)) +
    `${percent(depart)}%,100%{transform:translateY(0) rotate(0) scale(1)}}`
  const shadow =
    `@keyframes turtle-shadow{` +
    `0%,${percent(contact)}%{opacity:0.2;transform:translate(0,0) scale(1)}` +
    `${percent(mount)}%,${percent(brace)}%{opacity:0.12;transform:translate(1px,2px) scale(0.78)}` +
    `${percent(push)}%{opacity:0.08;transform:translate(2px,4px) scale(0.7)}` +
    `${percent(air)}%{opacity:0.04;transform:translate(2px,6px) scale(0.58)}` +
    `${percent(impact)}%{opacity:0.3;transform:translate(1px,3px) scale(1.28)}` +
    `${percent(splash)}%{opacity:0.24;transform:translate(1px,3px) scale(1.4)}` +
    `${percent(submerge)}%{opacity:0.18;transform:translate(0,2px) scale(1.18,0.72)}` +
    `${percent(depart)}%,100%{opacity:0.2;transform:translate(0,0) scale(1)}}`
  const limbs =
    `.paddle-phase{transform-box:fill-box;transform-origin:center;animation-duration:${duration}s;animation-delay:${delayCSS};animation-timing-function:linear;animation-iteration-count:infinite}` +
    `.paddle-front-left,.paddle-front-right{animation-name:turtle-front-paddle}` +
    `.paddle-rear-left,.paddle-rear-right{animation-name:turtle-rear-paddle}` +
    `@keyframes turtle-front-paddle{` +
    `0%,${percent(approach)}%{transform:translate(0,0) rotate(0)}` +
    `${percent(contact)}%{transform:translate(2px,0) rotate(-10deg)}` +
    `${percent(lift)}%{transform:translate(-2px,0) rotate(18deg)}` +
    `${percent(mount)}%{transform:translate(-1px,0) rotate(-12deg)}` +
    `${percent(walkStart)}%{transform:translate(0,0) rotate(3deg)}` +
    `${percent(step1)}%{transform:translate(1px,-1px) rotate(-16deg)}` +
    `${percent(step2)}%{transform:translate(-1px,1px) rotate(14deg)}` +
    `${percent(step3)}%{transform:translate(1px,-1px) rotate(-13deg)}` +
    `${percent(brace)}%{transform:translate(0,0) rotate(3deg)}` +
    `${percent(push)}%{transform:translate(2px,0) rotate(20deg)}` +
    `${percent(air)}%{transform:translate(-1px,0) rotate(-12deg)}` +
    `${percent(impact)}%{transform:translate(-2px,0) rotate(22deg)}` +
    `${percent(splash)}%{transform:translate(0,0) rotate(-6deg)}` +
    `${percent(submerge)}%{transform:translate(1px,0) rotate(10deg)}` +
    `${percent(depart)}%,100%{transform:translate(0,0) rotate(0)}}` +
    `@keyframes turtle-rear-paddle{` +
    `0%,${percent(approach)}%{transform:translate(0,0) rotate(0)}` +
    `${percent(contact)}%{transform:translate(-1px,0) rotate(8deg)}` +
    `${percent(lift)}%{transform:translate(2px,0) rotate(-18deg)}` +
    `${percent(mount)}%{transform:translate(1px,0) rotate(12deg)}` +
    `${percent(walkStart)}%{transform:translate(0,0) rotate(-3deg)}` +
    `${percent(step1)}%{transform:translate(-1px,1px) rotate(15deg)}` +
    `${percent(step2)}%{transform:translate(1px,-1px) rotate(-15deg)}` +
    `${percent(step3)}%{transform:translate(-1px,1px) rotate(14deg)}` +
    `${percent(brace)}%{transform:translate(0,0) rotate(-3deg)}` +
    `${percent(push)}%{transform:translate(-2px,0) rotate(-22deg)}` +
    `${percent(air)}%{transform:translate(1px,0) rotate(12deg)}` +
    `${percent(impact)}%{transform:translate(2px,0) rotate(-20deg)}` +
    `${percent(splash)}%{transform:translate(0,0) rotate(6deg)}` +
    `${percent(submerge)}%{transform:translate(-1px,0) rotate(-10deg)}` +
    `${percent(depart)}%,100%{transform:translate(0,0) rotate(0)}}`
  let tracks = `.snow-track{transform-box:fill-box;transform-origin:center;opacity:0}`
  for (let index = 0; index < 8; index++) {
    const localX = (index - 4) * 12
    const trackProgress = Math.max(0, Math.min(1, (floe.x + localX - entryWalk.x) / (exitBrace.x - entryWalk.x)))
    const reveal = walkStart + trackProgress * (brace - walkStart)
    tracks +=
      `.snow-track-${index}{animation:snow-track-${index} ${duration}s linear infinite;animation-delay:${delayCSS}}` +
      `@keyframes snow-track-${index}{0%,${percent(reveal)}%{opacity:0;transform:scale(0.45)}` +
      `${percent(reveal + 0.7)}%,94%{opacity:0.42;transform:scale(1)}99%,100%{opacity:0;transform:scale(1)}}`
  }
  const splashFrames = (name: string, event: number) =>
    `@keyframes ${name}{0%,${percent(event - 0.2)}%{opacity:0;transform:scale(0.2)}` +
    `${percent(event + 0.35)}%{opacity:0.68;transform:scale(0.7)}` +
    `${percent(event + 3.2)}%,100%{opacity:0;transform:scale(3.2)}}`
  const entryEvent = lift + 0.8
  const exitEvent = impact
  const splashes =
    `.turtle-splash{transform-box:fill-box;transform-origin:center;opacity:0}` +
    `.turtle-splash-in{animation:turtle-splash-in ${duration}s linear infinite;animation-delay:${delayCSS}}` +
    `.turtle-splash-out{animation:turtle-splash-out ${duration}s linear infinite;animation-delay:${delayCSS}}` +
    `.turtle-impact{transform-box:fill-box;transform-origin:center;opacity:0;animation:turtle-impact ${duration}s linear infinite;animation-delay:${delayCSS}}` +
    `.turtle-droplet{transform-box:fill-box;transform-origin:center;opacity:0;animation:turtle-droplet ${duration}s linear infinite;animation-delay:${delayCSS}}` +
    splashFrames('turtle-splash-in', entryEvent) +
    splashFrames('turtle-splash-out', exitEvent) +
    `@keyframes turtle-impact{0%,${percent(exitEvent - 0.12)}%{opacity:0;transform:scale(0.35)}` +
    `${percent(exitEvent + 0.22)}%{opacity:0.28;transform:scale(0.82)}` +
    `${percent(exitEvent + 1.55)}%,100%{opacity:0;transform:scale(2.1)}}` +
    `@keyframes turtle-droplet{0%,${percent(exitEvent - 0.08)}%{opacity:0;transform:translate(0,0) scale(0.5)}` +
    `${percent(exitEvent + 0.24)}%{opacity:0.72;transform:translate(var(--mx),var(--my)) scale(1)}` +
    `${percent(exitEvent + 1.45)}%,100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(0.2)}}`
  const entryWater = alongNormal(entry, 3)
  const effects =
    `<g data-pond-part="turtle-water-feedback" opacity="${iceAction.toFixed(3)}">` +
    `<circle class="turtle-splash turtle-splash-in" cx="${f1(entryWater.x)}" cy="${f1(entryWater.y)}" r="6" fill="none" stroke="${ripple}" stroke-width="1.2"/>` +
    `<circle class="turtle-splash turtle-splash-in" cx="${f1(entryWater.x)}" cy="${f1(entryWater.y)}" r="10" fill="none" stroke="${ripple}" stroke-width="0.8"/>` +
    `<ellipse class="turtle-impact" cx="${f1(exitImpact.x)}" cy="${f1(exitImpact.y)}" rx="8" ry="3" fill="${ripple}"/>` +
    `<circle class="turtle-splash turtle-splash-out" cx="${f1(exitImpact.x)}" cy="${f1(exitImpact.y)}" r="6" fill="none" stroke="${ripple}" stroke-width="1.4"/>` +
    `<circle class="turtle-splash turtle-splash-out" cx="${f1(exitImpact.x)}" cy="${f1(exitImpact.y)}" r="10" fill="none" stroke="${ripple}" stroke-width="0.9"/>` +
    `<circle class="turtle-droplet" style="--mx:-2.8px;--my:-2.1px;--dx:-8px;--dy:-6px" cx="${f1(exitImpact.x - 3)}" cy="${f1(exitImpact.y - 1)}" r="1.2" fill="${ripple}"/>` +
    `<circle class="turtle-droplet" style="--mx:-1.1px;--my:-3.2px;--dx:-3px;--dy:-9px" cx="${f1(exitImpact.x - 1)}" cy="${f1(exitImpact.y - 2)}" r="1" fill="${ripple}"/>` +
    `<circle class="turtle-droplet" style="--mx:1.4px;--my:-2.8px;--dx:4px;--dy:-8px" cx="${f1(exitImpact.x + 1)}" cy="${f1(exitImpact.y - 2)}" r="1.1" fill="${ripple}"/>` +
    `<circle class="turtle-droplet" style="--mx:3.2px;--my:-1.4px;--dx:9px;--dy:-4px" cx="${f1(exitImpact.x + 3)}" cy="${f1(exitImpact.y - 1)}" r="1.2" fill="${ripple}"/>` +
    `</g>`
  return {
    css: motion + body + shadow + limbs + tracks + splashes,
    effects,
    delay: initialDelay,
    iceAction,
    checkpoints: { entry: entryEvent, mount, walk: walkStart, brace, air, impact, splash, submerge },
  }
}

const escapeXML = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function renderSVG(
  grid: Grid,
  plan: Plan,
  theme: Theme,
  seed: string,
  context: RenderContext = {},
): { svg: string; meta: RenderMeta } {
  const width = svgWidth(grid.weeks)
  const timelineDuration = plan.duration
  const animationDuration = context.environment
    ? timelineDuration / context.environment.activityRate
    : timelineDuration
  const staticTime = context.staticTime ?? bestStaticTime(plan, width, seed, context.environment)
  const r = rng('decor:' + seed)

  const eatByCell = new Map(plan.eats.map(e => [e.cell, e]))

  const eatBuckets = new Set<string>()
  let planktonEls = ''
  let rippleEls = ''
  for (const c of grid.cells) {
    if (c.level === 0) continue
    const { x, y } = cellCenter(c.week, c.day)
    const eat = eatByCell.get(c.week * 7 + c.day)
    const highlighted = context.highlightedCells ? context.highlightedCells.has(c.week * 7 + c.day) : true
    const id = eat ? bucketId(bucketOf(eat.t, timelineDuration)) : null
    if (id) eatBuckets.add(id)
    const cls = id ? `pk e${id}` : 'pk'
    const rad = PLANKTON_R[c.level]
    const twinkle = c.level >= 3
      ? `<circle class="tw" style="animation-delay:-${((c.week * 7 + c.day) % 9) * 0.45}s" cx="${x}" cy="${y}" r="${(rad * 1.8).toFixed(1)}" fill="var(--plankton-halo)" opacity="0.14"/>`
      : ''
    planktonEls +=
      `<g class="${cls}">` +
      `<circle cx="${x}" cy="${y}" r="${(rad * 2.3).toFixed(1)}" fill="var(--plankton-glow-${c.level})"/>` +
      twinkle +
      `<circle cx="${x}" cy="${y}" r="${rad}" fill="var(--plankton-${c.level})"/>` +
      `</g>`
    if (id && eat) {
      const rippleRadius = 4.4 + eat.energy * 0.22 + (highlighted ? 0.8 : 0)
      const rippleWidth = (1 + eat.energy * 0.08) * (highlighted ? 1.35 : 1)
      rippleEls += `<circle class="rp r${id}${highlighted ? ' fresh' : ''}" cx="${x}" cy="${y}" r="${rippleRadius.toFixed(1)}" fill="none" stroke="var(--plankton-ripple)" stroke-width="${rippleWidth.toFixed(1)}"/>`
    }
  }

  let bucketCSS = ''
  for (const id of eatBuckets) {
    const b = parseFloat(id.replace('_', '.'))
    bucketCSS +=
      `@keyframes e${id}{0%,${b}%{transform:scale(1)}${(b + 0.7).toFixed(1)}%,95.5%{transform:scale(0)}99%,100%{transform:scale(1)}}` +
      `.e${id}{animation-name:e${id}}` +
      `@keyframes r${id}{0%,${b}%{transform:scale(0.35);opacity:0}${(b + 0.3).toFixed(2)}%{opacity:0.55}${(b + 3.2).toFixed(1)}%,100%{transform:scale(3.4);opacity:0}}` +
      `.r${id}{animation-name:r${id}}`
  }

  const streak = longestStreak(grid)
  const gap = longestGap(grid)
  const hasTurtle = streak >= TURTLE_STREAK
  const hasLotus = gap.len >= LOTUS_GAP
  const turtleY = LAYOUT.height - 26
  const lotusX = Math.min(Math.max(LAYOUT.padX + gap.centerWeek * LAYOUT.cell, 34), width - 34)
  const environment = context.environment
  const rayPeak = environment
    ? environment.daylight * (0.08 + environment.goldenLight * 0.13 + environment.sunStrength * 0.07)
    : 0.2
  const rayFloor = rayPeak * 0.36
  const causticOpacity = environment
    ? environment.daylight *
      (0.015 + environment.sunStrength * 0.105) *
      (0.82 + environment.seasonWeights.summer * 0.18) *
      (1 - environment.winterStillness * 0.32)
    : 0.07
  const surfaceMotion = environment
    ? environment.surfaceActivity *
      (0.45 + environment.daylight * 0.55) *
      (0.78 + environment.currentStrength * 0.22)
    : 1
  const sunElevation = environment
    ? Math.max(0, Math.min(1, (environment.solarAltitude + 6) / 72))
    : 0.72
  const shadowReach = 2 + (1 - sunElevation) * 5.5
  const shadowShiftX = environment ? -environment.sunDirection * shadowReach : 0
  const shadowShiftY = 0.8 + (1 - sunElevation) * 1.8
  const shadowStretch = 1 + (1 - sunElevation) * 0.05
  const currentDirection = environment?.currentDirection ?? 1
  const currentStrength = environment?.currentStrength ?? 0.7
  const currentVector = currentDirection * currentStrength
  const shadowDrift = (0.65 + surfaceMotion * 0.6) * currentVector
  const floorSoftness = 6.8 - sunElevation * 1.8
  const floorOpacityScale = environment ? 0.16 + environment.daylight * 0.38 : 0.54
  const directionalLightIntensity = environment
    ? environment.twilight * 0.2 +
      environment.goldenLight * 0.12 +
      environment.daylight * (0.018 + environment.sunStrength * 0.045)
    : 0.08
  const lightDrift = environment ? -environment.sunDirection * 2.4 : 1.2
  const moonDrift = currentVector * 3.2
  const lightLevel = theme.lightLevel
  const currentPeak = environment
    ? (0.07 + lightLevel * 0.07) *
      (0.42 + surfaceMotion * 0.58) *
      (0.72 + environment.currentStrength * 0.28) *
      (0.82 + environment.goldenLight * 0.18)
    : 0.07 + lightLevel * 0.07
  const currentFloor = currentPeak * 0.5
  const sheenIntensity = environment
    ? Math.min(1, 0.58 + environment.daylight * 0.32 + environment.goldenLight * 0.1)
    : 1
  const summerNightActivity = environment
    ? environment.summerBloom * environment.nightDepth
    : 0
  const winterSnowActivity = environment
    ? environment.winterStillness * (0.72 + environment.nightDepth * 0.28)
    : 0
  const seasonalSpectacle = Math.max(
    summerNightActivity,
    winterSnowActivity,
    environment?.mapleDrift ?? 0,
  )
  const ambientDensity = 1 - seasonalSpectacle * 0.55
  const moteCount = environment
    ? Math.max(2, Math.round((3 + surfaceMotion * 5) * ambientDensity))
    : 8
  const ambientRippleCount = environment
    ? Math.max(1, Math.round((1 + surfaceMotion * 3) * (1 - seasonalSpectacle * 0.35)))
    : 3
  const swayAngle = environment ? 0.9 + surfaceMotion * 2 : 2.6
  const swayBias = currentVector * 1.25
  const currentFromX = -22 * currentVector
  const currentToX = 24 * currentVector
  const causticFromX = -26 * currentVector
  const causticToX = 26 * currentVector
  const moteDriftX = 18 * currentVector
  const currentDuration = 23 - currentStrength * 7
  const turtleDuration = Math.max(36, Math.min(64, animationDuration * 0.6))
  const turtleScene = turtleChoreography(
    width,
    turtleY,
    seed,
    turtleDuration,
    theme.ripple,
    environment,
  )
  const turtleFloe = environment && environment.iceCoverage >= 0.18
    ? iceFloeLayout(width, seed, environment.iceCoverage)[1]
    : undefined
  const turtleRestX = width * 0.58 + ((turtleFloe?.x ?? width * 0.58) - width * 0.58) * turtleScene.iceAction
  const floeRestY = turtleFloe ? Math.min(turtleY - 6, turtleFloe.y - 2) : turtleY
  const turtleRestY = turtleY + (floeRestY - turtleY) * turtleScene.iceAction
  const paddleDuration = 1.4 - turtleScene.iceAction * 0.25
  const turtleDelay = `-${f1(turtleScene.delay)}s`
  const turtleMotionAttributes = turtleScene.checkpoints
    ? ` data-turtle-duration="${f1(turtleDuration)}" data-turtle-delay="${f1(turtleScene.delay)}"` +
      Object.entries(turtleScene.checkpoints)
        .map(([phase, at]) => ` data-turtle-${phase}="${at.toFixed(2)}"`)
        .join('')
    : ''
  const base = `
.pk,.rp{transform-box:fill-box;transform-origin:center;animation-duration:${animationDuration}s;animation-timing-function:linear;animation-iteration-count:infinite}
.rp{opacity:0}
.pt{transform-box:fill-box;transform-origin:center;animation:pec 1.05s ease-in-out infinite}
.pb{transform-box:fill-box;transform-origin:center;animation:pec 1.05s ease-in-out infinite reverse}
.tf{transform-box:fill-box;transform-origin:center;animation:tfk .6s ease-in-out infinite}
@keyframes pec{0%,100%{transform:rotate(14deg)}50%{transform:rotate(-12deg)}}
@keyframes tfk{0%,100%{transform:rotate(26deg)}50%{transform:rotate(-26deg)}}
.tw{animation:tw 3.6s ease-in-out infinite alternate}
.ray{opacity:${rayFloor.toFixed(3)};animation:ray 9.5s ease-in-out infinite alternate}
.sway{transform-box:fill-box;transform-origin:center;animation-name:sway;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.bloom{transform-box:fill-box;transform-origin:center;animation:bloom 5.2s ease-in-out infinite alternate}
.lotus-bud{transform-box:fill-box;transform-origin:center;animation:lotus-bud 4.8s ease-in-out infinite alternate}
.summer-lotus-bud{transform-box:fill-box;transform-origin:center;animation:summer-lotus-bud 5.4s ease-in-out infinite alternate}
.summer-lotus-drift{transform-box:fill-box;transform-origin:center;will-change:transform;animation-name:summer-lotus-drift;animation-timing-function:cubic-bezier(.42,.08,.58,.92);animation-iteration-count:infinite}
.spring-plant,.spring-blade,.spring-tip{transform-box:fill-box;transform-origin:center bottom;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-direction:alternate}
.spring-plant{animation-name:spring-plant}
.spring-blade{animation-name:spring-blade}
.spring-tip{animation-name:spring-tip}
.spring-bubble{transform-box:fill-box;transform-origin:center;opacity:0;animation-name:spring-bubble;animation-timing-function:linear;animation-iteration-count:infinite}
.firefly-flight{animation-name:firefly-flight;animation-timing-function:linear;animation-iteration-count:infinite}
.firefly-glow{transform-box:fill-box;transform-origin:center;animation-name:firefly-glow;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.lotus-visit{transform-box:fill-box;transform-origin:center;animation-name:lotus-visit;animation-timing-function:ease-out;animation-iteration-count:infinite}
.snowfall{animation-name:snowfall;animation-timing-function:linear;animation-iteration-count:infinite}
.snow-melt,.snow-settle{transform-box:fill-box;transform-origin:center;animation-timing-function:ease-out;animation-iteration-count:infinite}
.snow-melt{animation-name:snow-melt}
.snow-settle{animation-name:snow-settle}
.sun-path{transform-box:fill-box;transform-origin:center;animation:sun-path 12s ease-in-out infinite alternate}
.moon-path{transform-box:fill-box;transform-origin:center;animation:moon-path 10.5s ease-in-out infinite alternate}
.moon-path-b{animation-direction:alternate-reverse;animation-duration:13s}
.paddle{transform-box:fill-box;transform-origin:center;animation:paddle ${paddleDuration}s ease-in-out infinite alternate}
.ca{opacity:${causticOpacity.toFixed(3)};animation:ca 15s ease-in-out infinite alternate}
.floor{transform-box:fill-box;transform-origin:center;opacity:var(--floor-opacity,0.42);animation-name:floor;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.current{opacity:${currentPeak.toFixed(3)};animation:current ${currentDuration.toFixed(1)}s ease-in-out infinite alternate}
.mo{opacity:0;animation-name:mo;animation-timing-function:linear;animation-iteration-count:infinite}
.ar{transform-box:fill-box;transform-origin:center;opacity:0;animation:ar 9s linear infinite}
.maple{transform-box:fill-box;transform-origin:center;animation-name:maple;animation-timing-function:linear;animation-iteration-count:infinite}
.maple-body{transform-box:fill-box;transform-origin:center;animation:maple-body 3.2s ease-in-out infinite alternate}
.maple-wake{transform-box:fill-box;transform-origin:center;opacity:0;animation:maple-wake 4.2s ease-out infinite}
.ice-glint{animation:ice-glint 5.8s ease-in-out infinite alternate}
.turtle{transform:translate(${(width * 0.58).toFixed(1)}px,${turtleY}px);animation:turtle ${turtleDuration}s linear infinite;animation-delay:${turtleDelay}}
.turtle-body{transform-box:fill-box;transform-origin:center;animation:turtle-body ${turtleDuration}s linear infinite;animation-delay:${turtleDelay}}
.turtle-shadow{transform-box:fill-box;transform-origin:center;animation:turtle-shadow ${turtleDuration}s linear infinite;animation-delay:${turtleDelay}}
.night{opacity:0;animation:night ${animationDuration}s linear infinite}
@keyframes tw{from{opacity:0.06}to{opacity:0.26}}
@keyframes ray{from{opacity:${rayFloor.toFixed(3)}}to{opacity:${rayPeak.toFixed(3)}}}
@keyframes sway{from{transform:rotate(${(swayBias - swayAngle).toFixed(1)}deg)}to{transform:rotate(${(swayBias + swayAngle).toFixed(1)}deg)}}
@keyframes bloom{from{transform:scale(1)}to{transform:scale(1.04)}}
@keyframes lotus-bud{from{transform:translateY(0) rotate(-2deg)}to{transform:translateY(-0.5px) rotate(2deg)}}
@keyframes summer-lotus-bud{from{transform:scale(0.99)}to{transform:scale(1.01)}}
@keyframes summer-lotus-drift{0%,100%{transform:translate(var(--lotus-x0),var(--lotus-y0)) rotate(var(--lotus-r0))}43%{transform:translate(var(--lotus-x1),var(--lotus-y1)) rotate(var(--lotus-r1))}72%{transform:translate(var(--lotus-x2),var(--lotus-y2)) rotate(var(--lotus-r2))}}
@keyframes spring-plant{from{transform:rotate(var(--plant-r0))}to{transform:rotate(var(--plant-r1))}}
@keyframes spring-blade{from{transform:rotate(var(--blade-r0))}to{transform:rotate(var(--blade-r1))}}
@keyframes spring-tip{from{transform:rotate(var(--tip-r0))}to{transform:rotate(var(--tip-r1))}}
@keyframes spring-bubble{0%,10%{transform:translate(0,0) scale(0.55);opacity:0}18%{opacity:0.48}78%{opacity:0.34}100%{transform:translate(var(--bubble-x),var(--bubble-y)) scale(1.08);opacity:0}}
@keyframes firefly-flight{0%,100%{transform:translate(0,0)}29%{transform:translate(var(--ffx1),var(--ffy1))}64%{transform:translate(var(--ffx2),var(--ffy2))}82%{transform:translate(var(--ffx3),var(--ffy3))}}
@keyframes firefly-glow{0%,100%{transform:scale(0.76);opacity:0.34}28%{transform:scale(1.06);opacity:1}52%{transform:scale(0.82);opacity:0.4}76%{transform:scale(1);opacity:0.9}}
@keyframes lotus-visit{0%,54%,100%{transform:scale(0.35);opacity:0}62%{transform:scale(0.72);opacity:0.32}76%{transform:scale(1.45);opacity:0}}
@keyframes snowfall{0%{transform:translate(0,-14px) rotate(0);opacity:0}7%{opacity:var(--snow-opacity)}28%{transform:translate(var(--snow-x1),var(--snow-y1)) rotate(68deg);opacity:var(--snow-opacity)}58%{transform:translate(var(--snow-x2),var(--snow-y2)) rotate(148deg);opacity:var(--snow-opacity)}78%{transform:translate(var(--snow-x3),var(--snow-y3)) rotate(212deg);opacity:var(--snow-opacity)}82%,100%{transform:translate(var(--snow-x3),var(--snow-y3)) rotate(212deg);opacity:0}}
@keyframes snow-melt{0%,76%{transform:scale(0.2);opacity:0}80%{transform:scale(0.5);opacity:0.34}94%,100%{transform:scale(2.6);opacity:0}}
@keyframes snow-settle{0%,76%{transform:scale(0.25);opacity:0}81%{transform:scale(0.72);opacity:0.9}92%{transform:scale(1);opacity:0.72}100%{transform:scale(1.08);opacity:0}}
@keyframes sun-path{from{transform:translateX(${f1(-lightDrift)}px) scale(0.98)}to{transform:translateX(${f1(lightDrift)}px) scale(1.02)}}
@keyframes moon-path{from{transform:translateX(${f1(-moonDrift)}px) scale(0.94,0.98);opacity:0.72}to{transform:translateX(${f1(moonDrift)}px) scale(1.08,1.03);opacity:1}}
@keyframes paddle{from{transform:rotate(14deg)}to{transform:rotate(-14deg)}}
@keyframes ca{from{transform:translate(${f1(causticFromX)}px,0)}to{transform:translate(${f1(causticToX)}px,9px)}}
@keyframes floor{0%,100%{transform:translate(${f1(shadowShiftX - shadowDrift)}px,${f1(shadowShiftY - 0.6)}px) scale(${(shadowStretch * 0.99).toFixed(3)},0.99)}50%{transform:translate(${f1(shadowShiftX + shadowDrift)}px,${f1(shadowShiftY + 0.6)}px) scale(${(shadowStretch * 1.01).toFixed(3)},1.01)}}
@keyframes current{from{transform:translateX(${f1(currentFromX)}px);opacity:${currentFloor.toFixed(3)}}to{transform:translateX(${f1(currentToX)}px);opacity:${currentPeak.toFixed(3)}}}
@keyframes mo{0%{transform:translate(0,0);opacity:0}15%{opacity:0.55}85%{opacity:0.4}100%{transform:translate(${f1(moteDriftX)}px,-26px);opacity:0}}
@keyframes ar{0%{transform:scale(0.2);opacity:0}6%{opacity:0.22}26%,100%{transform:scale(3.6);opacity:0}}
@keyframes maple{0%{transform:translate(var(--mx0),0) rotate(0);opacity:0}6%{opacity:0.95}28%{transform:translate(var(--mx1),var(--my1)) rotate(95deg);opacity:0.95}63%{transform:translate(var(--mx2),var(--my2)) rotate(210deg);opacity:0.95}94%{opacity:0.9}100%{transform:translate(var(--mx3),var(--my3)) rotate(330deg);opacity:0}}
@keyframes maple-body{from{transform:translateY(-1px) rotate(-4deg)}to{transform:translateY(1px) rotate(4deg)}}
@keyframes maple-wake{0%{transform:scale(0.25);opacity:0}25%{opacity:0.18}100%{transform:scale(1.5);opacity:0}}
@keyframes ice-glint{from{opacity:0.56}to{opacity:0.9}}
${turtleScene.css}
@keyframes night{0%,91%{opacity:0}95%,97.5%{opacity:${theme.night}}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.rp,.tw,.mo,.ar,.night,.turtle-splash,.turtle-impact,.turtle-droplet,.snowfall,.snow-melt,.snow-settle,.lotus-visit{opacity:0!important}.floor{opacity:var(--floor-opacity,0.28)!important}.current{opacity:${currentPeak.toFixed(3)}}.ca{opacity:${causticOpacity.toFixed(3)}}.ray{opacity:${rayPeak.toFixed(3)}}.maple{transform:none;opacity:0.9}.firefly-glow{opacity:0.55}.snow-track{opacity:0.28!important}.turtle{transform:translate(${f1(turtleRestX)}px,${f1(turtleRestY)}px)}}
`

  const css = base + bucketCSS + fishKeyframes(plan, animationDuration)

  const planktonGlow = theme.plankton
    .map(
      (color, i) =>
        `<radialGradient id="pkg${i + 1}">` +
        `<stop offset="0" stop-color="${color}" stop-opacity="0.9"/>` +
        `<stop offset="0.45" stop-color="${color}" stop-opacity="0.32"/>` +
        `<stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
        `</radialGradient>`,
    )
    .join('')

  const owner = context.provenance?.owner
  const provenance = context.provenance
    ? `<metadata id="koipond-provenance">${escapeXML(JSON.stringify(context.provenance))}</metadata>`
    : ''
  const environmentMeta = context.environment
    ? `<metadata id="koipond-environment">${escapeXML(JSON.stringify(context.environment))}</metadata>`
    : ''
  const lotusPresence = environment?.bloom ?? 1
  const lotusOpenness = environment?.lotusOpenness ?? 1
  const contributionVariables = theme.plankton
    .map((color, index) => `--plankton-${index + 1}:${color};--plankton-glow-${index + 1}:url(#pkg${index + 1})`)
    .join(';') +
    `;--plankton-halo:${theme.halo ?? 'transparent'};--plankton-ripple:${theme.ripple}`
  const environmentDescription = context.environment
    ? ` It is ${context.environment.phase} in ${context.environment.season}.`
    : ''
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${LAYOUT.height}" width="${width}" height="${LAYOUT.height}" role="img" aria-labelledby="kp-title-${theme.key} kp-desc-${theme.key}" data-ambient-density="${ambientDensity.toFixed(3)}" data-ambient-motes="${moteCount}" data-ambient-ripples="${ambientRippleCount}">` +
    `<title id="kp-title-${theme.key}">${owner ? `${escapeXML(owner)}'s ` : ''}Contribution koi pond</title>` +
    `<desc id="kp-desc-${theme.key}">${plan.eats.length} contribution plankton grazed by ${plan.fishes.length} fish in a deterministic animated ecosystem${context.provenance ? `, cryptographically linked at revision ${context.provenance.revision}` : ''}.${environmentDescription}</desc>` +
    provenance +
    environmentMeta +
    `<style>${css}</style>` +
    `<defs>` +
    `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${theme.waterTop}"/>` +
    `<stop offset="0.55" stop-color="${theme.waterMid}"/>` +
    `<stop offset="1" stop-color="${theme.waterBottom}"/>` +
    `</linearGradient>` +
    `<linearGradient id="sheenG" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${theme.sheen}"/><stop offset="1" stop-color="${theme.sheen}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<linearGradient id="deepG" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${theme.deep}" stop-opacity="0"/><stop offset="1" stop-color="${theme.deep}"/>` +
    `</linearGradient>` +
    `<radialGradient id="floorG" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="${theme.floorBlotch}" stop-opacity="${(0.09 + lightLevel * 0.05).toFixed(3)}"/>` +
    `<stop offset="0.58" stop-color="${theme.floorBlotch}" stop-opacity="${(0.045 + lightLevel * 0.015).toFixed(3)}"/>` +
    `<stop offset="1" stop-color="${theme.floorBlotch}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="sunPathG" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="${theme.sheen}" stop-opacity="0.82"/>` +
    `<stop offset="0.5" stop-color="${theme.sheen}" stop-opacity="0.28"/>` +
    `<stop offset="1" stop-color="${theme.sheen}" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="moonPathG" cx="0.5" cy="0.5" r="0.5">` +
    `<stop offset="0" stop-color="#e9f8ff" stop-opacity="0.92"/>` +
    `<stop offset="0.42" stop-color="#c7eafa" stop-opacity="0.36"/>` +
    `<stop offset="1" stop-color="#9dd2e8" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="vig" cx="0.5" cy="0.5" r="0.72">` +
    `<stop offset="0.55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="${theme.vignette}"/>` +
    `</radialGradient>` +
    `<filter id="floorSoft" x="-40%" y="-60%" width="180%" height="220%"><feGaussianBlur stdDeviation="${floorSoftness.toFixed(2)}"/></filter>` +
    planktonGlow +
    SOFT_FILTER +
    theme.fishFilter +
    `</defs>` +
    `<rect width="${width}" height="${LAYOUT.height}" rx="10" fill="url(#water)"/>` +
    floorBlotches(width, r, floorOpacityScale) +
    directionalWaterLight(width, environment?.sunDirection ?? 0, directionalLightIntensity) +
    moonWaterLight(width, environment?.moonDirection ?? 0, environment?.moonStrength ?? 0) +
    waterCurrents(width, theme, r) +
    deepShade(width, theme) +
    caustics(width, theme) +
    godRays(width, theme, r, environment?.sunDirection) +
    springWaterPlants(
      width,
      theme,
      seed,
      environment?.seasonWeights.spring ?? 0,
      currentDirection,
      currentStrength,
      environment?.surfaceActivity ?? 1,
      environment?.daylight ?? 1,
    ) +
    `<g data-pond-part="contributions" style="${contributionVariables}"><g>${planktonEls}</g><g>${rippleEls}</g></g>` +
    pebbles(theme, r) +
    `<rect width="${width}" height="${LAYOUT.height}" rx="10" fill="url(#vig)"/>` +
    surfaceSheen(width, theme, sheenIntensity) +
    lilyPads(width, theme, seed, environment?.plantCoverage ?? 1) +
    summerBlooms(
      width,
      theme,
      seed,
      environment?.summerBloom ?? 0,
      lotusOpenness,
      currentDirection,
      currentStrength,
      environment?.surfaceActivity ?? 1,
      environment?.daylight ?? 1,
    ) +
    (hasLotus && lotusPresence >= 0.35
      ? `<g opacity="${lotusPresence.toFixed(3)}">${lotus(
          lotusX,
          theme,
          r,
          lotusOpenness,
          environment
            ? {
                currentDirection,
                currentStrength,
                surfaceActivity: environment.surfaceActivity,
                daylight: environment.daylight,
                intensity: environment.summerBloom,
              }
            : undefined,
        )}</g>`
      : '') +
    plan.fishes.map(f => fishSVG(f, theme, staticTime, timelineDuration, animationDuration)).join('') +
    summerFireflies(width, seed, summerNightActivity, lotusOpenness) +
    autumnMapleLeaves(
      width,
      theme,
      seed,
      environment?.mapleDrift ?? 0,
      environment?.currentDirection ?? 1,
      environment?.currentStrength ?? 0.5,
    ) +
    winterIce(width, theme, seed, environment?.iceCoverage ?? 0, hasTurtle) +
    (hasTurtle ? turtleScene.effects + turtle(theme, turtleMotionAttributes) : '') +
    winterSnowfall(
      width,
      seed,
      winterSnowActivity,
      environment?.iceCoverage ?? 0,
      environment?.currentDirection ?? 1,
      environment?.currentStrength ?? 0.5,
    ) +
    ambientRipples(width, theme, r, ambientRippleCount) +
    motes(width, theme, r, moteCount) +
    `<rect class="night" width="${width}" height="${LAYOUT.height}" rx="10" fill="${theme.nightTint}"/>` +
    `</svg>`

  return {
    svg,
    meta: {
      plankton: plan.eats.length,
      fish: plan.fishes.length,
      duration: Math.round(animationDuration * 10) / 10,
      turtle: hasTurtle,
      lotus: hasLotus,
      bytes: new TextEncoder().encode(svg).length,
    },
  }
}
