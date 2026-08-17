import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText } from '../src/environment'
import { plan } from '../src/planner'
import { themeForEnvironment } from '../src/render/palette'
import { renderSVG } from '../src/render/svg'
import { findBrowser } from '../src/video'

const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = outputArgument?.slice('--out='.length) || '.key-moment-regression'
const grid = demoGrid('key-moment-regression')

interface Box {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
}

const distance = (a: Box, b: Box) => Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY)
const finiteBox = (box: Box) => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

async function load(page: Page, svg: string) {
  await page.setViewport({ width: 737, height: 260, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:737px;height:auto}</style></head><body>${svg}</body></html>`,
    { waitUntil: 'load' },
  )
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.pause()))
}

async function setProgress(page: Page, selectors: string[], progress: number) {
  await page.evaluate(({ selectors, progress }) => {
    for (const selector of selectors) {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing animated element: ${selector}`)
      const animation = element.getAnimations()[0]
      if (!animation) throw new Error(`Missing animation: ${selector}`)
      const timing = animation.effect?.getTiming()
      const duration = Number(timing?.duration)
      const delay = Number(timing?.delay ?? 0)
      let currentTime = delay + duration * progress
      while (currentTime < 0) currentTime += duration
      animation.currentTime = currentTime
    }
  }, { selectors, progress })
}

async function setGlobalTime(page: Page, timeMs: number, names?: string[]) {
  await page.evaluate(({ timeMs, names }) => {
    for (const animation of document.getAnimations()) {
      const animationName = 'animationName' in animation ? String(animation.animationName) : ''
      if (!names || names.includes(animationName)) animation.currentTime = timeMs
    }
  }, { timeMs, names })
}

async function box(page: Page, selector: string): Promise<Box> {
  return await page.$eval(selector, element => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      centerX: rect.x + rect.width / 2,
      centerY: rect.y + rect.height / 2,
    }
  })
}

async function opacity(page: Page, selector: string): Promise<number> {
  return await page.$eval(selector, element => Number(getComputedStyle(element).opacity))
}

async function animationState(page: Page, selector: string) {
  return await page.$eval(selector, element => {
    const animation = element.getAnimations()[0]
    return {
      transform: getComputedStyle(element).transform,
      currentTime: Number(animation?.currentTime),
      progress: animation?.effect?.getComputedTiming().progress,
    }
  })
}

async function unionBox(page: Page, selector: string): Promise<Box> {
  return await page.$$eval(selector, elements => {
    const rectangles = elements.map(element => element.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0)
    const left = Math.min(...rectangles.map(rect => rect.left))
    const top = Math.min(...rectangles.map(rect => rect.top))
    const right = Math.max(...rectangles.map(rect => rect.right))
    const bottom = Math.max(...rectangles.map(rect => rect.bottom))
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2,
    }
  })
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: join(outputDirectory, `${name}.png`), omitBackground: true })
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })

const summerEnvironment = deriveEnvironment(momentFromText('2026-08-16', '00:00'), 'summer')
const summerPlan = plan(grid, 'key-moment-regression', undefined, summerEnvironment)
const summer = renderSVG(
  grid,
  summerPlan,
  themeForEnvironment(summerEnvironment),
  'key-moment-regression',
  { environment: summerEnvironment },
)
const winterEnvironment = deriveEnvironment(momentFromText('2026-01-15', '00:00'), 'winter')
const winterPlan = plan(grid, 'key-moment-regression', undefined, winterEnvironment)
const winter = renderSVG(
  grid,
  winterPlan,
  themeForEnvironment(winterEnvironment),
  'key-moment-regression',
  { environment: winterEnvironment },
)

const report: Record<string, unknown> = {}
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--disable-gpu', '--font-render-hinting=none'],
})

try {
  const page = await browser.newPage()

  await load(page, summer.svg)
  const fireflyIndex = await page.$eval(
    '.firefly-flight[data-firefly-role="lotus-visitor"]',
    element => element.getAttribute('data-firefly-index'),
  )
  assert(fireflyIndex !== null, 'Summer visitor has no stable pairing index')
  const flightSelector = `.firefly-flight[data-firefly-index="${fireflyIndex}"]`
  const visitSelector = `.lotus-visit[data-lotus-visit="${fireflyIndex}"]`
  await setProgress(page, [flightSelector, visitSelector], 0.5)
  const glintBefore = await opacity(page, visitSelector)
  await setProgress(page, [flightSelector, visitSelector], 0.64)
  const visitorAtLotus = await box(page, `${flightSelector} .firefly-glow`)
  const lotus = await box(page, visitSelector)
  const glintAtVisit = await opacity(page, visitSelector)
  const fireflyDistance = distance(visitorAtLotus, lotus)
  assert(finiteBox(visitorAtLotus) && finiteBox(lotus), 'Firefly arrival boxes are not visible')
  assert(fireflyDistance < 10, `Firefly missed its lotus by ${fireflyDistance.toFixed(2)}px`)
  assert(glintBefore < 0.02 && glintAtVisit > 0.18, 'Lotus glint is not synchronized with the firefly arrival')
  await capture(page, 'summer-firefly-arrival')
  report.firefly = { index: fireflyIndex, distance: fireflyDistance, glintBefore, glintAtVisit }

  await load(page, winter.svg)
  const snow: Record<string, unknown> = {}
  for (const target of ['ice', 'water'] as const) {
    const snowIndex = await page.$eval(
      `[data-snow-landing="${target}"]`,
      element => element.getAttribute('data-snow-index'),
    )
    assert(snowIndex !== null, `Winter scene has no ${target} snow landing`)
    const flakeSelector = `[data-snow-landing="${target}"][data-snow-index="${snowIndex}"] .snowfall`
    const effectSelector = `[data-snow-effect="${target}"][data-snow-index="${snowIndex}"]${target === 'ice' ? ' .snow-settle' : ''}`
    await setProgress(page, [flakeSelector, effectSelector], 0.74)
    const effectBefore = await opacity(page, effectSelector)
    await setProgress(page, [flakeSelector], 0.78)
    const landingFlake = await box(page, flakeSelector)
    const landingEffect = await box(page, effectSelector)
    await setProgress(page, [effectSelector], 0.82)
    const effectAfter = await opacity(page, effectSelector)
    const landingDistance = distance(landingFlake, landingEffect)
    const flakeState = await animationState(page, flakeSelector)
    const effectState = await animationState(page, effectSelector)
    assert(finiteBox(landingFlake) && finiteBox(landingEffect), `${target} snow landing boxes are invalid`)
    assert(
      landingDistance < 3.5,
      `${target} snow effect is ${landingDistance.toFixed(2)}px from its flake: ` +
        JSON.stringify({ landingFlake, landingEffect, flakeState, effectState }),
    )
    assert(effectBefore < 0.02 && effectAfter > 0.2, `${target} snow landing effect does not appear after contact`)
    snow[target] = { index: snowIndex, distance: landingDistance, effectBefore, effectAfter }
  }
  await capture(page, 'winter-snow-landings')
  report.snow = snow

  const turtleData = await page.$eval('.turtle[data-turtle-duration]', element => ({
    duration: Number(element.getAttribute('data-turtle-duration')),
    delay: Number(element.getAttribute('data-turtle-delay')),
    mount: Number(element.getAttribute('data-turtle-mount')),
    walk: Number(element.getAttribute('data-turtle-walk')),
    brace: Number(element.getAttribute('data-turtle-brace')),
    air: Number(element.getAttribute('data-turtle-air')),
    impact: Number(element.getAttribute('data-turtle-impact')),
    submerge: Number(element.getAttribute('data-turtle-submerge')),
  }))
  assert(Object.values(turtleData).every(Number.isFinite), 'Turtle checkpoints are incomplete')
  const turtleTime = (percent: number) => (turtleData.duration * percent / 100 - turtleData.delay) * 1000
  const turtleNames = [
    'turtle',
    'turtle-body',
    'turtle-shadow',
    'turtle-front-paddle',
    'turtle-rear-paddle',
    'turtle-splash-in',
    'turtle-splash-out',
    'turtle-impact',
    'turtle-droplet',
  ]
  await setGlobalTime(page, turtleTime(turtleData.mount), turtleNames)
  const mounted = await box(page, '.turtle-body')
  const floe = await box(page, '[data-ice-floe="1"]')
  assert(
    mounted.centerX >= floe.x - 8 && mounted.centerX <= floe.x + floe.width + 8 &&
      mounted.centerY >= floe.y - 8 && mounted.centerY <= floe.y + floe.height + 8,
    'Turtle mount checkpoint does not reach the ice floe',
  )
  await capture(page, 'winter-turtle-mount')
  await setGlobalTime(page, turtleTime(turtleData.air), turtleNames)
  const airborne = await box(page, '.turtle-body')
  const impactBefore = await opacity(page, '.turtle-impact')
  await setGlobalTime(page, turtleTime(turtleData.impact + 0.22), turtleNames)
  const impacted = await box(page, '.turtle-body')
  const impactAfter = await opacity(page, '.turtle-impact')
  assert(airborne.centerY < impacted.centerY - 3, 'Turtle no longer rises before entering the water')
  assert(impactBefore < 0.02 && impactAfter > 0.2, 'Turtle water impact is not synchronized with entry')
  await setGlobalTime(page, turtleTime(turtleData.submerge), turtleNames)
  const submerged = await box(page, '.turtle-body')
  assert(submerged.centerY > airborne.centerY + 4, 'Turtle does not descend into the water after impact')
  await capture(page, 'winter-turtle-submerge')
  report.turtle = { mounted, floe, airborne, impacted, submerged, impactBefore, impactAfter, checkpoints: turtleData }

  const fishNames = winterPlan.fishes.map(fish => `fp${fish.id}`)
  const animationDurationMs = winter.meta.duration * 1000
  await setGlobalTime(page, 20, fishNames)
  const seamStart = await unionBox(page, '.f0')
  await setGlobalTime(page, animationDurationMs - 20, fishNames)
  const seamEnd = await unionBox(page, '.f0')
  const seamDistance = distance(seamStart, seamEnd)
  const seamSizeDelta = Math.abs(seamStart.width - seamEnd.width) + Math.abs(seamStart.height - seamEnd.height)
  assert(finiteBox(seamStart) && finiteBox(seamEnd), 'Fish is incomplete at the animation seam')
  assert(seamStart.width > 15 || seamStart.height > 15, 'Fish body collapsed at the animation seam')
  assert(seamDistance < 3.5, `Fish jumps ${seamDistance.toFixed(2)}px across the animation seam`)
  assert(seamSizeDelta < 3, `Fish body stretches ${seamSizeDelta.toFixed(2)}px across the animation seam`)
  await capture(page, 'fish-loop-seam')
  report.fishSeam = { start: seamStart, end: seamEnd, distance: seamDistance, sizeDelta: seamSizeDelta }
} finally {
  await browser.close()
}

writeFileSync(join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`${outputDirectory}/report.json  firefly, snow, turtle and fish seam key moments verified`)
