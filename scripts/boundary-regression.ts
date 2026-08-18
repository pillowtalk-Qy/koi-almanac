import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import sharp from 'sharp'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText, type PondEnvironment } from '../src/environment'
import { plan } from '../src/planner'
import { themeForEnvironment } from '../src/render/palette'
import { renderSVG } from '../src/render/svg'
import { findBrowser } from '../src/video'

const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = outputArgument?.slice('--out='.length) || '.boundary-regression'
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

interface MomentText {
  date: string
  time: string
}

interface BoundaryPair {
  name: string
  before: MomentText
  after: MomentText
}

interface PixelDelta {
  meanDelta: number
  mismatchRatio: number
}

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const dateAt = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10)
const timeAt = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

function seasonAndFeatureBoundaries(): BoundaryPair[] {
  const pairs: BoundaryPair[] = []
  const featureState = (environment: PondEnvironment) => ({
    ice: environment.iceCoverage >= 0.18,
    springGrowth: environment.seasonWeights.spring >= 0.08,
    summerBloom: environment.summerBloom >= 0.08,
    summerFireflies: environment.summerBloom * environment.nightDepth >= 0.08,
    autumnMaple: environment.mapleDrift >= 0.08,
    winterSnow: environment.winterStillness * (0.72 + environment.nightDepth * 0.28) >= 0.08,
  })

  for (const time of ['12:00', '00:00']) {
    let previous = deriveEnvironment(momentFromText(dateAt(1), time))
    let previousFeatures = featureState(previous)
    for (let day = 2; day <= 365; day++) {
      const current = deriveEnvironment(momentFromText(dateAt(day), time))
      const currentFeatures = featureState(current)
      if (current.season !== previous.season) {
        pairs.push({
          name: `season-${previous.season}-to-${current.season}-${time === '12:00' ? 'day' : 'night'}`,
          before: { date: dateAt(day - 1), time },
          after: { date: dateAt(day), time },
        })
      }
      for (const feature of Object.keys(currentFeatures) as Array<keyof typeof currentFeatures>) {
        if (currentFeatures[feature] === previousFeatures[feature]) continue
        pairs.push({
          name: `${feature}-${currentFeatures[feature] ? 'enter' : 'leave'}-${time === '12:00' ? 'day' : 'night'}`,
          before: { date: dateAt(day - 1), time },
          after: { date: dateAt(day), time },
        })
      }
      previous = current
      previousFeatures = currentFeatures
    }
  }
  return pairs
}

function solarBoundaries(date: string): BoundaryPair[] {
  const pairs: BoundaryPair[] = []
  let previous = deriveEnvironment(momentFromText(date, timeAt(0)))
  let previousThemeKey = themeForEnvironment(previous).key
  for (let minute = 1; minute < 1_440; minute++) {
    const current = deriveEnvironment(momentFromText(date, timeAt(minute)))
    const currentThemeKey = themeForEnvironment(current).key
    if (current.phase !== previous.phase) {
      pairs.push({
        name: `${date}-${previous.phase}-to-${current.phase}`,
        before: { date, time: timeAt(minute - 1) },
        after: { date, time: timeAt(minute) },
      })
    }
    if (currentThemeKey !== previousThemeKey) {
      pairs.push({
        name: `${date}-${previousThemeKey}-to-${currentThemeKey}`,
        before: { date, time: timeAt(minute - 1) },
        after: { date, time: timeAt(minute) },
      })
    }
    previous = current
    previousThemeKey = currentThemeKey
  }
  return pairs
}

async function captureSVG(page: Page, svg: string): Promise<Buffer> {
  await page.setViewport({ width: 737, height: 186, deviceScaleFactor: 1 })
  await page.setContent(
    '<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}' +
      'svg{display:block;width:737px;height:186px}</style></head><body>' + svg + '</body></html>',
    { waitUntil: 'load' },
  )
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause()
      animation.currentTime = 18_000
    }
  })
  return await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
}

async function pixelDelta(before: Buffer, after: Buffer): Promise<PixelDelta> {
  const [left, right] = await Promise.all([
    sharp(before).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(after).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  let total = 0
  let mismatched = 0
  const pixels = left.data.length / 4
  for (let offset = 0; offset < left.data.length; offset += 4) {
    let pixelMaximum = 0
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(left.data[offset + channel] - right.data[offset + channel])
      total += delta
      pixelMaximum = Math.max(pixelMaximum, delta)
    }
    if (pixelMaximum > 28) mismatched++
  }
  return { meanDelta: total / left.data.length, mismatchRatio: mismatched / pixels }
}

async function visualBoundaryRegression(page: Page) {
  const grid = demoGrid('boundary-regression')
  const winter = deriveEnvironment(momentFromText('2026-01-15', '12:00'), 'winter')
  const stablePlan = plan(grid, 'boundary-regression', undefined, winter)
  const pairs = [
    ...seasonAndFeatureBoundaries(),
    ...solarBoundaries('2026-01-15'),
    ...solarBoundaries('2026-08-16'),
  ]
  const uniquePairs = [...new Map(pairs.map(pair => [pair.name, pair])).values()]
  const report: Array<BoundaryPair & PixelDelta> = []

  for (const pair of uniquePairs) {
    const render = (moment: MomentText) => {
      const environment = deriveEnvironment(momentFromText(moment.date, moment.time))
      return renderSVG(
        grid,
        stablePlan,
        themeForEnvironment(environment),
        'boundary-regression',
        { environment },
      ).svg
    }
    const before = await captureSVG(page, render(pair.before))
    const after = await captureSVG(page, render(pair.after))
    const delta = await pixelDelta(before, after)
    writeFileSync(join(outputDirectory, `${pair.name}-before.png`), before)
    writeFileSync(join(outputDirectory, `${pair.name}-after.png`), after)
    assert(
      delta.meanDelta < 3.8 && delta.mismatchRatio < 0.045,
      `${pair.name} jumps across its boundary: mean ${delta.meanDelta.toFixed(3)}, ` +
        `${(delta.mismatchRatio * 100).toFixed(2)}% mismatched pixels`,
    )
    report.push({ ...pair, ...delta })
  }
  return report
}

type PhaseMap = Record<string, number>

const circularDistance = (left: number, right: number) => {
  const distance = Math.abs(left - right)
  return Math.min(distance, 1 - distance)
}

async function pondPhases(page: Page): Promise<PhaseMap> {
  return await page.$eval('#pond', pond => {
    const phases: Record<string, number> = {}
    for (const animation of pond.getAnimations({ subtree: true })) {
      const name = 'animationName' in animation ? String(animation.animationName) : ''
      if (!/^(?:fp0|turtle)$/.test(name) || name in phases) continue
      const duration = Number(animation.effect?.getTiming().duration)
      const currentTime = Number(animation.currentTime)
      phases[name] = ((currentTime % duration) + duration) % duration / duration
    }
    return phases
  })
}

async function interactionBoundaryRegression(page: Page) {
  const html = readFileSync('site/index.html', 'utf8')
  const bundle = readFileSync('site/demo.js', 'utf8')
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/demo.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/demo.js' ? bundle : html)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Boundary regression server did not bind')
    const contributions = demoGrid('boundary-ui').cells.map(cell => ({
      date: cell.date,
      count: 1,
      level: 1,
    }))
    await page.setRequestInterception(true)
    page.on('request', request => {
      if (request.url().includes('/v1/contributions/')) {
        void request.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ contributions }),
        })
      } else {
        void request.continue()
      }
    })
    await page.goto(
      `http://127.0.0.1:${address.port}/?user=boundary-test&date=2026-01-15&time=12%3A00`,
      { waitUntil: 'networkidle0' },
    )
    await page.waitForSelector('#result:not([hidden])')
    await delay(250)
    await page.evaluate(() => {
      const state = window as typeof window & { __pondMounts?: number }
      state.__pondMounts = 0
      new MutationObserver(records => {
        if (records.some(record => record.type === 'childList')) state.__pondMounts = (state.__pondMounts ?? 0) + 1
      }).observe(document.getElementById('pond')!, { childList: true })
    })

    const before = await pondPhases(page)
    assert(Number.isFinite(before.fp0) && Number.isFinite(before.turtle), 'Fish or turtle animation is missing before drag')
    await page.$eval('#year-timeline', timeline => {
      for (let value = 35; value <= 125; value += 3) {
        timeline.value = String(value)
        timeline.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    await delay(260)
    const preview = await pondPhases(page)
    const previewMounts = await page.evaluate(() =>
      (window as typeof window & { __pondMounts?: number }).__pondMounts ?? 0,
    )
    assert(previewMounts <= 4, `Rapid timeline input mounted ${previewMounts} SVGs instead of being coalesced`)
    assert(circularDistance(before.fp0, preview.fp0) < 0.06, 'Fish animation phase reset during timeline preview')
    assert(circularDistance(before.turtle, preview.turtle) < 0.08, 'Turtle animation phase reset during timeline preview')

    await page.$eval('#year-timeline', timeline => timeline.dispatchEvent(new Event('change', { bubbles: true })))
    await delay(560)
    const committed = await pondPhases(page)
    const committedMounts = await page.evaluate(() =>
      (window as typeof window & { __pondMounts?: number }).__pondMounts ?? 0,
    )
    assert(committedMounts > previewMounts, 'Timeline release did not perform a final committed render')
    assert(circularDistance(preview.fp0, committed.fp0) < 0.08, 'Fish animation phase reset after timeline release')
    assert(circularDistance(preview.turtle, committed.turtle) < 0.1, 'Turtle animation phase reset after timeline release')
    await page.screenshot({ path: join(outputDirectory, 'timeline-committed.png'), fullPage: true })
    return { before, preview, committed, previewMounts, committedMounts }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--disable-gpu', '--font-render-hinting=none'],
})

try {
  const visualPage = await browser.newPage()
  const visual = await visualBoundaryRegression(visualPage)
  await visualPage.close()
  const interactionPage = await browser.newPage()
  const interaction = await interactionBoundaryRegression(interactionPage)
  writeFileSync(join(outputDirectory, 'report.json'), JSON.stringify({ visual, interaction }, null, 2) + '\n')
  console.log(
    `${visual.length} adjacent visual boundaries stayed continuous; ` +
      `${interaction.previewMounts} preview mount(s), ${interaction.committedMounts} after commit; ` +
      'fish and turtle phases preserved',
  )
} finally {
  await browser.close()
}
