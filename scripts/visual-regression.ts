import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import sharp from 'sharp'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText, type PondSeason } from '../src/environment'
import { plan } from '../src/planner'
import { themeForEnvironment } from '../src/render/palette'
import { renderSVG } from '../src/render/svg'
import type { Cell, Grid } from '../src/types'
import { findBrowser } from '../src/video'

const root = process.cwd()
const baselineDirectory = join(root, 'test', 'visual-baselines')
const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = join(root, outputArgument?.slice('--out='.length) || '.visual-regression')
const update = process.argv.includes('--update')
const pixelThreshold = 24
const mismatchLimit = 0.008
const winterNightMismatchLimit = 0.012
const meanDeltaLimit = 2.2

const moments: Array<{ date: string; season: PondSeason }> = [
  { date: '2026-04-16', season: 'spring' },
  { date: '2026-08-16', season: 'summer' },
  { date: '2026-10-16', season: 'autumn' },
  { date: '2026-01-15', season: 'winter' },
]

const viewports = [
  { name: 'desktop', width: 737 },
  { name: 'mobile', width: 390 },
] as const

function sparseGrid(seed: string): Grid {
  const grid = demoGrid(seed)
  const cells = grid.cells.map((cell, index): Cell => {
    if (cell.count > 0 && (index % 9 === 0 || index % 37 === 0)) {
      const count = Math.min(3, cell.count)
      const level = (count >= 3 ? 2 : count > 0 ? 1 : 0) as Cell['level']
      return { ...cell, count, level }
    }
    return { ...cell, count: 0, level: 0 }
  })
  return { ...grid, cells }
}

const profiles = [
  { name: 'active', seed: 'visual-active', grid: demoGrid('visual-active') },
  { name: 'sparse', seed: 'visual-sparse', grid: sparseGrid('visual-sparse') },
] as const

interface Comparison {
  name: string
  width: number
  height: number
  digest: string
  mismatchRatio: number
  meanDelta: number
  status: 'created' | 'matched' | 'changed'
}

async function capture(page: Page, svg: string, width: number): Promise<Buffer> {
  await page.setViewport({ width, height: 260, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}#pond{width:${width}px}svg{display:block;width:100%;height:auto}</style></head><body><div id="pond">${svg}</div></body></html>`,
    { waitUntil: 'load' },
  )
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      animation.pause()
      const duration = animation.effect?.getComputedTiming().duration
      animation.currentTime = typeof duration === 'number' && Number.isFinite(duration) ? duration * 0.37 : 0
    }
  })
  const pond = await page.$('#pond')
  if (!pond) throw new Error('Visual regression pond did not render')
  return await pond.screenshot({ type: 'png', omitBackground: true }) as Buffer
}

async function rawImage(png: Buffer) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function compareImages(name: string, current: Buffer, baseline: Buffer): Promise<Comparison> {
  const [actual, expected] = await Promise.all([rawImage(current), rawImage(baseline)])
  const { width, height, channels } = actual.info
  if (width !== expected.info.width || height !== expected.info.height || channels !== expected.info.channels) {
    return {
      name,
      width,
      height,
      digest: createHash('sha256').update(current).digest('hex'),
      mismatchRatio: 1,
      meanDelta: 255,
      status: 'changed',
    }
  }

  const pixels = width * height
  const difference = Buffer.alloc(actual.data.length)
  let mismatchCount = 0
  let totalDelta = 0
  for (let offset = 0; offset < actual.data.length; offset += channels) {
    let maximum = 0
    for (let channel = 0; channel < channels; channel++) {
      const delta = Math.abs(actual.data[offset + channel] - expected.data[offset + channel])
      maximum = Math.max(maximum, delta)
      totalDelta += delta
    }
    if (maximum > pixelThreshold) {
      mismatchCount++
      difference[offset] = 255
      difference[offset + 1] = 48
      difference[offset + 2] = 82
      difference[offset + 3] = 255
    } else {
      difference[offset] = Math.round(expected.data[offset] * 0.18)
      difference[offset + 1] = Math.round(expected.data[offset + 1] * 0.18)
      difference[offset + 2] = Math.round(expected.data[offset + 2] * 0.18)
      difference[offset + 3] = 180
    }
  }

  const mismatchRatio = mismatchCount / pixels
  const meanDelta = totalDelta / actual.data.length
  const scenarioMismatchLimit = name.includes('winter-night') ? winterNightMismatchLimit : mismatchLimit
  const status = mismatchRatio <= scenarioMismatchLimit && meanDelta <= meanDeltaLimit ? 'matched' : 'changed'
  if (status === 'changed') {
    await sharp(difference, { raw: { width, height, channels } })
      .png()
      .toFile(join(outputDirectory, `${name}-diff.png`))
  }
  return {
    name,
    width,
    height,
    digest: createHash('sha256').update(current).digest('hex'),
    mismatchRatio,
    meanDelta,
    status,
  }
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })
if (update) {
  rmSync(baselineDirectory, { recursive: true, force: true })
  mkdirSync(baselineDirectory, { recursive: true })
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--disable-gpu', '--font-render-hinting=none'],
})
const comparisons: Comparison[] = []
try {
  const page = await browser.newPage()
  for (const profile of profiles) {
    for (const moment of moments) {
      for (const time of ['12:00', '00:00']) {
        const phase = time === '12:00' ? 'day' : 'night'
        const environment = deriveEnvironment(momentFromText(moment.date, time), moment.season)
        const pond = plan(profile.grid, profile.seed, undefined, environment)
        const svg = renderSVG(
          profile.grid,
          pond,
          themeForEnvironment(environment),
          profile.seed,
          { environment },
        ).svg

        for (const viewport of viewports) {
          const name = `${profile.name}-${moment.season}-${phase}-${viewport.name}`
          const current = await capture(page, svg, viewport.width)
          const currentFile = join(outputDirectory, `${name}.png`)
          writeFileSync(currentFile, current)
          const baselineFile = join(baselineDirectory, `${name}.png`)
          if (update) {
            writeFileSync(baselineFile, current)
            const metadata = await sharp(current).metadata()
            comparisons.push({
              name,
              width: metadata.width ?? 0,
              height: metadata.height ?? 0,
              digest: createHash('sha256').update(current).digest('hex'),
              mismatchRatio: 0,
              meanDelta: 0,
              status: 'created',
            })
          } else {
            if (!existsSync(baselineFile)) {
              throw new Error(`Missing visual baseline ${baselineFile}; run npm run visual:update`)
            }
            comparisons.push(await compareImages(name, current, await sharp(baselineFile).png().toBuffer()))
          }
        }
      }
    }
  }
} finally {
  await browser.close()
}

const report = {
  thresholds: { pixelThreshold, mismatchLimit, winterNightMismatchLimit, meanDeltaLimit },
  scenarios: comparisons,
}
writeFileSync(join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (update) writeFileSync(join(baselineDirectory, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')

const changed = comparisons.filter(comparison => comparison.status === 'changed')
if (changed.length > 0) {
  const details = changed.map(comparison =>
    `${comparison.name}: ${(comparison.mismatchRatio * 100).toFixed(2)}% pixels, mean delta ${comparison.meanDelta.toFixed(2)}`,
  )
  throw new Error(`Visual regression failed:\n${details.join('\n')}\nArtifacts: ${outputDirectory}`)
}

console.log(`${comparisons.length} visual scenarios ${update ? 'recorded' : 'matched'} across seasons, phases, profiles and viewports`)
