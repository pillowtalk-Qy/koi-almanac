import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import {
  renderReadmeShowcase,
  SHOWCASE_LOOP_SECONDS,
  SHOWCASE_TRANSITION_SECONDS,
  showcaseScenes,
} from '../src/showcase'
import { findBrowser } from '../src/video'

const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = outputArgument?.slice('--out='.length) || '.showcase-regression'
const tracked = readFileSync('assets/demo-cycle.svg', 'utf8')
const generated = renderReadmeShowcase()
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

if (tracked !== generated) {
  throw new Error('assets/demo-cycle.svg is stale; run npm run build:showcase')
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })

async function pixels(png: Buffer) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function meanDelta(first: Buffer, second: Buffer): Promise<number> {
  const [a, b] = await Promise.all([pixels(first), pixels(second)])
  if (a.data.length !== b.data.length) throw new Error('Showcase captures have different dimensions')
  let total = 0
  for (let index = 0; index < a.data.length; index++) total += Math.abs(a.data[index] - b.data[index])
  return total / a.data.length
}

async function opaqueRatio(png: Buffer): Promise<number> {
  const image = await pixels(png)
  let opaque = 0
  for (let index = 3; index < image.data.length; index += image.info.channels) {
    if (image.data[index] > 245) opaque++
  }
  return opaque / (image.info.width * image.info.height)
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--disable-gpu', '--font-render-hinting=none'],
})
const report: Array<Record<string, unknown>> = []

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 737, height: 186, deviceScaleFactor: 1 })
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden}svg{display:block}</style></head>` +
      `<body>${tracked}</body></html>`,
    { waitUntil: 'load' },
  )
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await delay(350)
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.pause()))

  const scenes = showcaseScenes()
  const slotSeconds = SHOWCASE_LOOP_SECONDS / scenes.length
  const digests = new Set<string>()

  for (const [index, scene] of scenes.entries()) {
    const timeMs = (index * slotSeconds + slotSeconds / 2) * 1000
    await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), timeMs)
    const opacities = await page.$$eval('.showcase-scene', elements =>
      elements.map(element => Number(getComputedStyle(element).opacity)),
    )
    if (opacities[index] < 0.99 || opacities.some((opacity, item) => item !== index && opacity > 0.01)) {
      throw new Error(`Showcase scene ${index} is not isolated at ${timeMs}ms: ${opacities.join(', ')}`)
    }

    const capture = await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
    const file = `${String(index + 1).padStart(2, '0')}-${scene.season}-${scene.phase}.png`
    writeFileSync(join(outputDirectory, file), capture)
    const digest = createHash('sha256').update(capture).digest('hex')
    const opacity = await opaqueRatio(capture)
    if (opacity < 0.98) throw new Error(`Showcase scene ${index} rendered blank or translucent: ${opacity}`)
    digests.add(digest)
    report.push({ index, ...scene, timeMs, digest, opaqueRatio: opacity })
  }

  if (digests.size !== scenes.length) throw new Error('One or more showcase scenes rendered identically')

  const transitionTime = (slotSeconds - SHOWCASE_TRANSITION_SECONDS / 2) * 1000
  await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), transitionTime)
  const transitionOpacities = await page.$$eval('.showcase-scene', elements =>
    elements.map(element => Number(getComputedStyle(element).opacity)),
  )
  const transitionSum = transitionOpacities[0] + transitionOpacities[1]
  if (
    transitionOpacities[0] < 0.35 || transitionOpacities[0] > 0.65 ||
    transitionOpacities[1] < 0.35 || transitionOpacities[1] > 0.65 ||
    Math.abs(transitionSum - 1) > 0.08 || transitionOpacities.slice(2).some(opacity => opacity > 0.01)
  ) {
    throw new Error(`Showcase crossfade is not balanced: ${transitionOpacities.join(', ')}`)
  }

  const motionTime = (slotSeconds + slotSeconds / 2) * 1000
  await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), motionTime)
  const before = await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
  await delay(500)
  const after = await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
  const motionDelta = await meanDelta(before, after)
  if (motionDelta < 0.08) throw new Error(`Embedded pond animation appears frozen: mean delta ${motionDelta}`)

  writeFileSync(
    join(outputDirectory, 'report.json'),
    JSON.stringify({ scenes: report, transitionOpacities, motionDelta }, null, 2) + '\n',
  )
  console.log(
    `${scenes.length} living scenes verified across a ${SHOWCASE_LOOP_SECONDS}s loop; ` +
    `balanced ${SHOWCASE_TRANSITION_SECONDS}s crossfade; motion delta ${motionDelta.toFixed(3)}`,
  )
} finally {
  await browser.close()
}
