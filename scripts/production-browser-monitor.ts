import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { findBrowser } from '../src/video'

const explorer = process.env.KOIPOND_EXPLORER_URL ?? 'https://pillowtalk-qy.github.io/koi-almanac/'
const user = 'pillowtalk-Qy'
const output = resolve('.production-browser-monitor')
const scenarios = [
  {
    name: 'desktop', width: 1440, height: 900, reducedMotion: false,
    timezone: 'America/New_York', latitude: 40.7128, longitude: -74.006,
  },
  {
    name: 'mobile', width: 390, height: 844, reducedMotion: true,
    timezone: 'Australia/Sydney', latitude: -33.8688, longitude: 151.2093,
  },
] as const

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message)
}

async function checkExplorer(page: Page, scenario: typeof scenarios[number]) {
  let cacheStatus = ''
  page.on('response', response => {
    if (response.url().includes('/v1/contributions/')) cacheStatus = response.headers()['x-koipond-cache'] ?? ''
  })
  const url = new URL(explorer)
  url.searchParams.set('user', user)
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('#result:not([hidden])', { timeout: 30_000 })
  await page.waitForFunction(() => document.documentElement.dataset.renderWorker === 'active', { timeout: 15_000 })
  await page.waitForSelector('#pond svg', { visible: true, timeout: 15_000 })
  const layout = await page.evaluate(() => {
    const pondElement = document.querySelector('#pond')
    const svgElement = document.querySelector('#pond svg')
    const pond = pondElement?.getBoundingClientRect()
    const svg = svgElement?.getBoundingClientRect()
    const controls = [...document.querySelectorAll<HTMLElement>('button, input, a')]
    const clippedControls: string[] = []
    for (const element of controls) {
      if (element.offsetParent !== null && element.scrollWidth > element.clientWidth + 2) {
        clippedControls.push(element.id || element.textContent?.trim().slice(0, 30) || element.tagName)
      }
    }
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      pond: pond ? { width: pond.width, height: pond.height, left: pond.left, right: pond.right } : null,
      svg: svg ? { width: svg.width, height: svg.height } : null,
      clippedControls,
      status: document.getElementById('status')?.textContent ?? '',
      queue: document.documentElement.dataset.renderQueue,
    }
  })
  assert(layout.documentWidth <= layout.viewport + 1, `${scenario.name} explorer overflows horizontally`)
  assert(layout.pond && layout.pond.width > 280 && layout.pond.height > 80, `${scenario.name} pond is not visible`)
  assert(layout.pond.left >= -1 && layout.pond.right <= layout.viewport + 1, `${scenario.name} pond escapes the viewport`)
  assert(layout.svg && layout.svg.width > 280 && layout.svg.height > 60, `${scenario.name} SVG is not rendered`)
  assert(layout.clippedControls.length === 0, `${scenario.name} clips controls: ${layout.clippedControls.join(', ')}`)
  assert(!/unavailable|failed|error/i.test(layout.status), `${scenario.name} explorer reports an error: ${layout.status}`)
  assert(['HIT', 'MISS', 'STALE'].includes(cacheStatus), `${scenario.name} contribution cache status is missing`)
  const localState = await page.evaluate((expectedTimezone: string) => ({
    label: document.getElementById('moment-label')?.textContent ?? '',
    localPressed: document.querySelector('[data-time-basis="local"]')?.getAttribute('aria-pressed'),
    locationEnabled: !(document.getElementById('local-environment') as HTMLInputElement)?.disabled,
    legacyThemes: document.querySelectorAll('#tabs, [data-theme]').length,
    expectedTimezone,
  }), scenario.timezone)
  assert(localState.localPressed === 'true', `${scenario.name} explorer does not default to local time`)
  assert(localState.label.includes(localState.expectedTimezone), `${scenario.name} explorer ignores the browser timezone`)
  assert(localState.locationEnabled, `${scenario.name} local environment control is unavailable`)
  assert(localState.legacyThemes === 0, `${scenario.name} explorer still exposes redundant light/dark controls`)

  await page.click('[data-time-basis="hong-kong"]')
  await page.waitForFunction(() => document.getElementById('moment-label')?.textContent?.includes('Hong Kong'))
  assert(new URL(page.url()).searchParams.get('view') === 'hong-kong', `${scenario.name} Hong Kong view is not shareable`)
  await page.click('[data-time-basis="local"]')
  await page.waitForFunction((expectedTimezone: string) =>
    document.getElementById('moment-label')?.textContent?.includes(expectedTimezone), {}, scenario.timezone)

  await page.click('#local-environment')
  await page.waitForFunction((expectedLatitude: number) => {
    const metadata = document.querySelector('#pond metadata#koipond-environment')?.textContent
    if (!metadata) return false
    const environment = JSON.parse(metadata) as { latitude?: number }
    return Math.abs(Number(environment.latitude) - expectedLatitude) < 0.01
  }, {}, scenario.latitude)
  const localEnvironment = await page.$eval('#pond metadata#koipond-environment', element =>
    JSON.parse(element.textContent ?? '{}') as { latitude?: number; longitude?: number })
  assert(Math.abs(Number(localEnvironment.latitude) - scenario.latitude) < 0.01, `${scenario.name} latitude was not applied`)
  assert(Math.abs(Number(localEnvironment.longitude) - scenario.longitude) < 0.01, `${scenario.name} longitude was not applied`)
  await page.screenshot({ path: resolve(output, `explorer-${scenario.name}.png`), fullPage: true })
  return cacheStatus
}

async function checkVerifier(page: Page, scenario: typeof scenarios[number]) {
  const url = new URL('verify.html', explorer)
  url.searchParams.set('user', user)
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('#result:not([hidden])', { timeout: 30_000 })
  const result = await page.evaluate(() => {
    const button = document.getElementById('verify-button')
    return {
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      verdict: document.getElementById('verdict')?.dataset.verdict,
      failures: document.querySelectorAll('.check-fail').length,
      passes: document.querySelectorAll('.check-pass').length,
      recorded: document.querySelectorAll('.check-recorded').length,
      status: document.getElementById('status')?.textContent ?? '',
      buttonClipped: button ? button.scrollWidth > button.clientWidth + 2 : true,
    }
  })
  assert(result.documentWidth <= result.viewport + 1, `${scenario.name} verifier overflows horizontally`)
  assert(result.verdict === 'valid' && result.failures === 0, `${scenario.name} verifier did not validate production`)
  assert(result.passes === 5 && result.recorded === 1, `${scenario.name} verifier returned an unexpected check set`)
  assert(!result.buttonClipped, `${scenario.name} verifier button text is clipped`)
  assert(/completed/i.test(result.status), `${scenario.name} verifier did not finish cleanly`)
  await page.screenshot({ path: resolve(output, `verifier-${scenario.name}.png`), fullPage: true })
}

rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: true,
  args: ['--disable-gpu', '--font-render-hinting=none'],
})

try {
  for (const scenario of scenarios) {
    const page = await browser.newPage()
    await page.setViewport({ width: scenario.width, height: scenario.height, deviceScaleFactor: 1 })
    await page.emulateTimezone(scenario.timezone)
    await browser.defaultBrowserContext().overridePermissions(new URL(explorer).origin, ['geolocation'])
    await page.setGeolocation({ latitude: scenario.latitude, longitude: scenario.longitude })
    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: scenario.reducedMotion ? 'reduce' : 'no-preference' },
      { name: 'prefers-color-scheme', value: 'dark' },
    ])
    const cacheStatus = await checkExplorer(page, scenario)
    await checkVerifier(page, scenario)
    await page.close()
    console.log(`PASS ${scenario.name}  explorer + verifier  contribution cache ${cacheStatus}`)
  }
} finally {
  await browser.close()
}
