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

  const summerDayIndex = scenes.findIndex(scene => scene.season === 'summer' && scene.phase === 'day')
  const summerNightIndex = scenes.findIndex(scene => scene.season === 'summer' && scene.phase === 'night')
  const summerDayTime = (summerDayIndex * slotSeconds + slotSeconds / 2) * 1000
  await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), summerDayTime)
  const lotusSelector =
    `.readme-demo-scene-${summerDayIndex} .rd${summerDayIndex}-summer-lotus-drift[data-lotus-motion="current-drift"]`
  const lotusMotion = await page.$eval(lotusSelector, element => ({
    direction: Number(element.getAttribute('data-lotus-current')),
    amplitude: Number(element.getAttribute('data-lotus-drift-x')),
  }))
  const seekLotus = async (progress: number) => {
    return await page.$eval(lotusSelector, (element, value) => {
      const animation = element.getAnimations()[0]
      if (!animation) throw new Error('README summer lotus has no native animation')
      const timing = animation.effect?.getTiming()
      const duration = Number(timing?.duration)
      const delay = Number(timing?.delay ?? 0)
      let currentTime = delay + duration * value
      while (currentTime < 0) currentTime += duration
      animation.currentTime = currentTime
      const rect = element.getBoundingClientRect()
      return { centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 }
    }, progress)
  }
  const lotusStart = await seekLotus(0)
  const lotusWithCurrent = await seekLotus(0.72)
  const lotusTravelX = lotusWithCurrent.centerX - lotusStart.centerX
  const lotusTravel = Math.hypot(lotusTravelX, lotusWithCurrent.centerY - lotusStart.centerY)
  if (lotusTravel <= 2 || lotusTravel >= 7 || Math.sign(lotusTravelX) !== lotusMotion.direction) {
    throw new Error(`README summer lotus motion is invalid: ${JSON.stringify({ lotusMotion, lotusTravel, lotusTravelX })}`)
  }

  const summerNightTime = (summerNightIndex * slotSeconds + slotSeconds / 2) * 1000
  await page.evaluate(ms => document.getAnimations().forEach(animation => (animation.currentTime = ms)), summerNightTime)
  const nightLotus = await page.$eval(`.readme-demo-scene-${summerNightIndex}`, (scene, prefix) => {
    const sleeping = scene.querySelectorAll('[data-lotus-state="sleeping"][data-lotus-openness="0.120"]').length
    const buds = scene.querySelectorAll('[data-lotus-form="closed-bud"]').length
    const openStage = scene.querySelector(`.${prefix}-lotus-open-stage`)
    const bud = scene.querySelector(`.${prefix}-summer-lotus-bud`)
    return {
      sleeping,
      buds,
      openOpacity: openStage ? Number(getComputedStyle(openStage).opacity) : 1,
      budOpacity: bud ? Number(getComputedStyle(bud).opacity) : 0,
    }
  }, `rd${summerNightIndex}`)
  if (nightLotus.sleeping < 3 || nightLotus.buds < 3 || nightLotus.openOpacity > 0.02 || nightLotus.budOpacity < 0.75) {
    throw new Error(`README summer night lotus is not closed: ${JSON.stringify(nightLotus)}`)
  }
  const lotus = { ...lotusMotion, travel: lotusTravel, travelX: lotusTravelX, night: nightLotus }

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
    JSON.stringify({ scenes: report, lotus, transitionOpacities, transformBefore, transformAfter, motionDelta }, null, 2) + '\n',
  )
  console.log(
    `${scenes.length} native environments verified across ${README_DEMO_LOOP_SECONDS}s; ` +
    `lotus drifted ${lotusTravel.toFixed(2)}px; fish moved; motion delta ${motionDelta.toFixed(3)}`,
  )
} finally {
  await browser.close()
}
