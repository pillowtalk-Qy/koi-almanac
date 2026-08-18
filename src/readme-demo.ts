import { demoGrid } from './demo'
import { deriveEnvironment, momentFromText, type PondSeason } from './environment'
import { svgWidth } from './layout'
import { plan } from './planner'
import { themeForEnvironment } from './render/palette'
import { bestStaticTime, renderSVG } from './render/svg'

export const README_DEMO_LOOP_SECONDS = 24
export const README_DEMO_TRANSITION_SECONDS = 1.1

const scenes: Array<{ season: PondSeason; phase: 'day' | 'night'; date: string; time: string }> = [
  { season: 'spring', phase: 'day', date: '2026-04-16', time: '12:00' },
  { season: 'spring', phase: 'night', date: '2026-04-16', time: '00:00' },
  { season: 'summer', phase: 'day', date: '2026-08-16', time: '12:00' },
  { season: 'summer', phase: 'night', date: '2026-08-16', time: '00:00' },
  { season: 'autumn', phase: 'day', date: '2026-10-16', time: '12:00' },
  { season: 'autumn', phase: 'night', date: '2026-10-16', time: '00:00' },
  { season: 'winter', phase: 'day', date: '2026-01-15', time: '12:00' },
  { season: 'winter', phase: 'night', date: '2026-01-15', time: '00:00' },
]

const percent = (value: number) => `${Number(value.toFixed(3))}%`

function sceneKeyframes(index: number): string {
  const slot = 100 / scenes.length
  const fade = README_DEMO_TRANSITION_SECONDS / README_DEMO_LOOP_SECONDS * 100
  const start = index * slot
  const end = (index + 1) * slot
  const name = `readme-demo-scene-${index}`

  if (index === 0) {
    return `@keyframes ${name}{0%,${percent(end - fade)}{opacity:1}` +
      `${percent(end)},${percent(100 - fade)}{opacity:0}100%{opacity:1}}`
  }

  return `@keyframes ${name}{0%,${percent(start - fade)}{opacity:0}` +
    `${percent(start)},${percent(end - fade)}{opacity:1}${percent(end)},100%{opacity:0}}`
}

const sharedPlanAnimation = /^(?:e\d+|r\d+|fp\d+)$/

function splitSharedPlanMotion(svg: string): { scene: string; sharedCSS: string } {
  const style = /<style>([\s\S]*?)<\/style>/.exec(svg)
  if (!style || style.index === undefined) throw new Error('README demo scene has no style block')

  const css = style[1]
  const foodStart = css.search(/@keyframes e\d+/)
  const fishStart = css.indexOf('@keyframes fp0')
  const sharedStart = [foodStart, fishStart].filter(index => index >= 0).sort((a, b) => a - b)[0]
  if (sharedStart === undefined) throw new Error('README demo scene has no shared pond motion')

  let sceneCSS = css.slice(0, sharedStart)
  const symbolMotion = /^\s*\.pk,.rp\{[\s\S]*?\.tw\{[^}]+\}\s*/.exec(sceneCSS)?.[0]
  const twinkleKeyframes = /@keyframes tw\{from\{[^}]+\}to\{[^}]+\}\}/.exec(sceneCSS)?.[0]
  if (!symbolMotion || !twinkleKeyframes) throw new Error('README demo scene has no shared symbol motion')
  sceneCSS = sceneCSS.replace(symbolMotion, '').replace(twinkleKeyframes, '')
  const sharedCSS = symbolMotion + twinkleKeyframes + css.slice(sharedStart)
  const scene = svg.slice(0, style.index) + `<style>${sceneCSS}</style>` + svg.slice(style.index + style[0].length)
  return { scene, sharedCSS }
}

function namespaceScene(svg: string, prefix: string, sceneIndex: number): string {
  const root = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(svg)
  if (!root) throw new Error('README demo scene is not a complete SVG')

  return root[1]
    .replace(/<(?:title|desc|metadata)\b[^>]*>[\s\S]*?<\/(?:title|desc|metadata)>/g, '')
    .replace(/(^|\s)id="([^"]+)"/g, `$1id="${prefix}-$2"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}-$1"`)
    .replace(/@keyframes\s+([A-Za-z_][\w-]*)/g, (_match, name: string) =>
      `@keyframes ${sharedPlanAnimation.test(name) ? name : `${prefix}-${name}`}`,
    )
    .replace(/animation-name:\s*([A-Za-z_][\w-]*)/g, (_match, name: string) =>
      `animation-name:${sharedPlanAnimation.test(name) ? name : `${prefix}-${name}`}`,
    )
    .replace(/animation:\s*([A-Za-z_][\w-]*)/g, (_match, name: string) =>
      `animation:${name === 'none' || sharedPlanAnimation.test(name) ? name : `${prefix}-${name}`}`,
    )
    .replace(/\.([A-Za-z_][\w-]*)/g, `.readme-demo-scene-${sceneIndex} .$1`)
}

interface SharedFish {
  id: string
  geometry: string
}

function fishGroupEnd(scene: string, start: number): { closeStart: number; end: number } {
  const token = /<g\b[^>]*>|<\/g>/g
  token.lastIndex = start
  let depth = 0
  for (let match = token.exec(scene); match; match = token.exec(scene)) {
    if (match[0].startsWith('</')) {
      depth--
      if (depth === 0) return { closeStart: match.index, end: token.lastIndex }
    } else {
      depth++
    }
  }
  throw new Error('README demo fish group is not balanced')
}

function shareFishGeometry(scene: string, shared: Map<string, SharedFish>): string {
  let output = ''
  let cursor = 0
  while (true) {
    const start = scene.indexOf('<g data-fish-id="', cursor)
    if (start < 0) break
    const openEnd = scene.indexOf('>', start)
    if (openEnd < 0) throw new Error('README demo fish group has no opening tag')
    const opening = scene.slice(start, openEnd + 1)
    const id = /data-fish-id="([^"]+)"/.exec(opening)?.[1]
    const style = /style="([^"]+)"/.exec(opening)?.[1]
    if (!id || !style) throw new Error('README demo fish group is missing identity or palette variables')
    const bounds = fishGroupEnd(scene, start)
    const geometry = scene.slice(openEnd + 1, bounds.closeStart)
    const existing = shared.get(id)
    if (existing && existing.geometry !== geometry) {
      throw new Error(`README demo fish ${id} produced different geometry between scenes`)
    }
    if (!existing) shared.set(id, { id, geometry })
    output += scene.slice(cursor, start) +
      `<g data-fish-id="${id}" style="${style}"><use href="#readme-fish-${id}"/></g>`
    cursor = bounds.end
  }
  return output + scene.slice(cursor)
}

function shareContributionGeometry(scene: string, shared: { geometry?: string }): string {
  const start = scene.indexOf('<g data-pond-part="contributions"')
  if (start < 0) throw new Error('README demo scene has no contribution layer')
  const openEnd = scene.indexOf('>', start)
  if (openEnd < 0) throw new Error('README demo contribution layer has no opening tag')
  const opening = scene.slice(start, openEnd + 1)
  const style = /style="([^"]+)"/.exec(opening)?.[1]
  if (!style) throw new Error('README demo contribution layer has no palette variables')
  const bounds = fishGroupEnd(scene, start)
  const geometry = scene.slice(openEnd + 1, bounds.closeStart)
  if (shared.geometry && shared.geometry !== geometry) {
    throw new Error('README demo contribution geometry changed between scenes')
  }
  shared.geometry ??= geometry
  const instance = `<g data-pond-part="contributions" style="${style}">` +
    `<use href="#readme-contributions"/></g>`
  return scene.slice(0, start) + instance + scene.slice(bounds.end)
}

export function renderReadmeDemo(seed = 'koi-almanac-readme'): string {
  const grid = demoGrid(seed)
  const environments = scenes.map(scene => ({
    ...deriveEnvironment(momentFromText(scene.date, scene.time), scene.season),
    activityRate: 1,
  }))
  const winterEnvironment = environments.find(environment => environment.season === 'winter')
  if (!winterEnvironment) throw new Error('The README demo requires a winter environment')

  // One winter-safe plan preserves fish, food and feeding time across every environmental state.
  const pond = plan(grid, seed, undefined, winterEnvironment)
  const staticTime = bestStaticTime(pond, svgWidth(grid.weeks), seed, winterEnvironment)
  let sharedPlanCSS = ''
  const sharedFish = new Map<string, SharedFish>()
  const sharedContributions: { geometry?: string } = {}
  const rendered = scenes.map((scene, index) => {
    const environment = environments[index]
    const svg = renderSVG(grid, pond, themeForEnvironment(environment), seed, { environment, staticTime }).svg
    const split = splitSharedPlanMotion(svg)
    if (index === 0) sharedPlanCSS = split.sharedCSS
    else if (split.sharedCSS !== sharedPlanCSS) {
      throw new Error(`README demo scene ${index} produced different shared pond motion`)
    }
    const namespaced = namespaceScene(split.scene, `rd${index}`, index)
    const contributionShared = shareContributionGeometry(namespaced, sharedContributions)
    return { ...scene, content: shareFishGeometry(contributionShared, sharedFish) }
  })

  const classes = scenes.map((_, index) =>
    `.readme-demo-scene-${index}{animation-name:readme-demo-scene-${index}}`,
  ).join('')
  const keyframes = scenes.map((_, index) => sceneKeyframes(index)).join('')
  const groups = rendered.map((scene, index) =>
    `<g class="readme-demo-scene readme-demo-scene-${index}" ` +
      `data-readme-season="${scene.season}" data-readme-phase="${scene.phase}">` +
      `${scene.content}</g>`,
  ).join('')
  const fishSymbols = [...sharedFish.values()]
    .map(fish => `<symbol id="readme-fish-${fish.id}" overflow="visible">${fish.geometry}</symbol>`)
    .join('')
  if (!sharedContributions.geometry) throw new Error('README demo has no shared contribution geometry')
  const contributionSymbol =
    `<symbol id="readme-contributions" overflow="visible">${sharedContributions.geometry}</symbol>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 737 186" width="737" height="186" ` +
    `role="img" aria-labelledby="readme-demo-title readme-demo-desc">` +
    `<title id="readme-demo-title">Koi Almanac living year</title>` +
    `<desc id="readme-demo-desc">One continuously animated contribution pond moving through ` +
    `day and night in spring, summer, autumn and winter.</desc>` +
    `<style>.readme-demo-scene{opacity:0;animation-duration:${README_DEMO_LOOP_SECONDS}s;` +
    `animation-timing-function:cubic-bezier(0.45,0,0.55,1);animation-iteration-count:infinite}` +
    `${classes}${keyframes}${sharedPlanCSS}` +
    `@media (prefers-reduced-motion:reduce){.readme-demo-scene{animation:none;opacity:0}` +
    `.readme-demo-scene-0{opacity:1}}</style><defs>${contributionSymbol}${fishSymbols}</defs>${groups}</svg>`
}

export function readmeDemoScenes() {
  return scenes.map(scene => ({ ...scene }))
}
