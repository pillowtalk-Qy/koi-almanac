import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import {
  renderReadmeDemo,
  README_DEMO_LOOP_SECONDS,
  README_DEMO_TRANSITION_SECONDS,
  readmeDemoScenes,
} from '../src/readme-demo'
import { findBrowser } from '../src/video'

const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = outputArgument?.slice('--out='.length) || '.readme-demo-regression'
const tracked = readFileSync('assets/demo-almanac.svg', 'utf8')
const generated = renderReadmeDemo()
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

if (tracked !== generated) {
  throw new Error('assets/demo-almanac.svg is stale; run npm run build:readme-demo')
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })

async function pixels(png: Buffer) {
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function meanDelta(first: Buffer, second: Buffer): Promise<number> {
  const [a, b] = await Promise.all([pixels(first), pixels(second)])
  let total = 0
  for (let index = 0; index < a.data.length; index++) total += Math.abs(a.data[index] - b.data[index])
  return total / a.data.length
}

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--disable-gpu', '--font-render-hinting=none'],
})

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

  const scenes = readmeDemoScenes()
  const slotSeconds = README_DEMO_LOOP_SECONDS / scenes.length
  const report: Array<Record<string, unknown>> = []
  const digests = new Set<string>()

  for (const [index, scene] of scenes.entries()) {
    const timeMs = (index * slotSeconds + slotSeconds / 2) * 1000
    await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), timeMs)
    const opacities = await page.$$eval('.readme-demo-scene', elements =>
      elements.map(element => Number(getComputedStyle(element).opacity)),
    )
    if (opacities[index] < 0.99 || opacities.some((opacity, item) => item !== index && opacity > 0.01)) {
      throw new Error(`README scene ${index} is not isolated at ${timeMs}ms: ${opacities.join(', ')}`)
    }

    const capture = await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
    const file = `${String(index + 1).padStart(2, '0')}-${scene.season}-${scene.phase}.png`
    writeFileSync(join(outputDirectory, file), capture)
    const digest = createHash('sha256').update(capture).digest('hex')
    digests.add(digest)
    report.push({ index, ...scene, timeMs, digest })
  }

  if (digests.size !== scenes.length) throw new Error('One or more README environments rendered identically')

  const transitionTime = (slotSeconds - README_DEMO_TRANSITION_SECONDS / 2) * 1000
  await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), transitionTime)
  const transitionOpacities = await page.$$eval('.readme-demo-scene', elements =>
    elements.map(element => Number(getComputedStyle(element).opacity)),
  )
  if (
    transitionOpacities[0] < 0.35 || transitionOpacities[0] > 0.65 ||
    transitionOpacities[1] < 0.35 || transitionOpacities[1] > 0.65 ||
    Math.abs(transitionOpacities[0] + transitionOpacities[1] - 1) > 0.08 ||
    transitionOpacities.slice(2).some(opacity => opacity > 0.01)
  ) {
    throw new Error(`README transition is not balanced: ${transitionOpacities.join(', ')}`)
  }
  writeFileSync(
    join(outputDirectory, 'transition-spring-day-to-night.png'),
    await page.screenshot({ type: 'png', omitBackground: true }) as Buffer,
  )

  const motionTime = (3 * slotSeconds + slotSeconds / 2) * 1000
  await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), motionTime)
  const fishSelector = '.rd3-f0'
  const transformBefore = await page.$eval(fishSelector, element => getComputedStyle(element).transform)
  const before = await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const name = 'animationName' in animation ? String(animation.animationName) : ''
      if (name.startsWith('rd3-') && !name.startsWith('rd3-readme-demo-scene')) animation.play()
    }
  })
  await delay(650)
  const transformAfter = await page.$eval(fishSelector, element => getComputedStyle(element).transform)
  const after = await page.screenshot({ type: 'png', omitBackground: true }) as Buffer
  const motionDelta = await meanDelta(before, after)
  if (transformBefore === transformAfter || motionDelta < 0.08) {
    throw new Error(`Native fish animation appears frozen: ${transformBefore}, delta ${motionDelta}`)
  }

  writeFileSync(
    join(outputDirectory, 'report.json'),
    JSON.stringify({ scenes: report, transitionOpacities, transformBefore, transformAfter, motionDelta }, null, 2) + '\n',
  )
  console.log(
    `${scenes.length} native environments verified across ${README_DEMO_LOOP_SECONDS}s; ` +
    `fish moved; motion delta ${motionDelta.toFixed(3)}`,
  )
} finally {
  await browser.close()
}
