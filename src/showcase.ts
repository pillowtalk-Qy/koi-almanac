import { demoGrid } from './demo'
import { deriveEnvironment, momentFromText, type PondSeason } from './environment'
import { plan } from './planner'
import { themeForEnvironment } from './render/palette'
import { renderSVG } from './render/svg'

export const SHOWCASE_LOOP_SECONDS = 32

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
  const fade = 1.4
  const start = index * slot
  const end = (index + 1) * slot
  const name = `showcase-scene-${index}`

  if (index === 0) {
    return `@keyframes ${name}{0%,${percent(end - fade)}{opacity:1}` +
      `${percent(end)},${percent(100 - fade)}{opacity:0}100%{opacity:1}}`
  }

  return `@keyframes ${name}{0%,${percent(start - fade)}{opacity:0}` +
    `${percent(start)},${percent(end - fade)}{opacity:1}${percent(end)},100%{opacity:0}}`
}

export function renderReadmeShowcase(seed = 'koi-almanac-showcase'): string {
  const grid = demoGrid(seed)
  const rendered = scenes.map(scene => {
    const environment = deriveEnvironment(momentFromText(scene.date, scene.time), scene.season)
    const pond = plan(grid, seed, undefined, environment)
    const svg = renderSVG(grid, pond, themeForEnvironment(environment), seed, { environment }).svg
    return { ...scene, data: Buffer.from(svg).toString('base64') }
  })

  const classes = scenes.map((_, index) =>
    `.showcase-scene-${index}{animation-name:showcase-scene-${index}}`,
  ).join('')
  const keyframes = scenes.map((_, index) => sceneKeyframes(index)).join('')
  const images = rendered.map((scene, index) =>
    `<image class="showcase-scene showcase-scene-${index}" ` +
      `data-showcase-season="${scene.season}" data-showcase-phase="${scene.phase}" ` +
      `width="737" height="186" href="data:image/svg+xml;base64,${scene.data}"/>`,
  ).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 737 186" width="737" height="186" ` +
    `role="img" aria-labelledby="showcase-title showcase-desc">` +
    `<title id="showcase-title">Koi Almanac seasonal cycle</title>` +
    `<desc id="showcase-desc">A living contribution pond moving through spring, summer, autumn, ` +
    `winter, daylight and night.</desc>` +
    `<style>.showcase-scene{opacity:0;animation-duration:${SHOWCASE_LOOP_SECONDS}s;` +
    `animation-timing-function:linear;animation-iteration-count:infinite}${classes}${keyframes}` +
    `@media (prefers-reduced-motion:reduce){.showcase-scene{animation:none;opacity:0}` +
    `.showcase-scene-0{opacity:1}}</style>${images}</svg>`
}

export function showcaseScenes() {
  return scenes.map(scene => ({ ...scene }))
}
