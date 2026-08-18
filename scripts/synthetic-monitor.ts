import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  validateContributions,
  validateExplorer,
  validateHealth,
  validateProfileDelivery,
  validateProfilePresentation,
  validateProductionArtifacts,
} from '../src/synthetic-monitor'
import type { PondGenerator } from '../src/state'

interface MonitorConfig {
  schemaVersion: number
  explorer: string
  worker: string
  syntheticUser: string
  timezoneOffsetMinutes: number
  profilePage: string
  profileReadme: string
  profileSvg: string
  profileState: string
}

interface ReleaseManifest {
  schemaVersion: number
  action: PondGenerator
}

interface Retrieved {
  body: string
  response: Response
}

const root = process.cwd()
const config = JSON.parse(readFileSync(resolve(root, 'monitor.json'), 'utf8')) as MonitorConfig
const release = JSON.parse(readFileSync(resolve(root, 'release.json'), 'utf8')) as ReleaseManifest
if (config.schemaVersion !== 2 || release.schemaVersion !== 1) throw new Error('Unsupported monitor or release schema')

const wait = (milliseconds: number) => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))

async function retrieve(
  name: string,
  url: string,
  accept: string,
  options: { origin?: string; maximumBytes?: number } = {},
): Promise<Retrieved> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = performance.now()
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: accept,
          'Cache-Control': 'no-cache',
          'User-Agent': 'koi-almanac-synthetic-monitor/1.0 (+https://github.com/pillowtalk-Qy/koi-almanac)',
          ...(options.origin ? { Origin: options.origin } : {}),
        },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const maximumBytes = options.maximumBytes ?? 3_000_000
      if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
        throw new Error(`response size ${bytes.byteLength} is outside 1..${maximumBytes}`)
      }
      console.log(`PASS ${name}  HTTP ${response.status}  ${Math.round(performance.now() - started)}ms`)
      return { body: new TextDecoder().decode(bytes), response }
    } catch (error) {
      lastError = error
      if (attempt < 3) await wait(attempt * 1_000)
    }
  }
  throw new Error(`FAIL ${name}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const explorerURL = new URL(config.explorer)
const explorer = await retrieve('explorer html', explorerURL.href, 'text/html')
const bundle = await retrieve('explorer bundle', new URL('demo.js', explorerURL).href, 'text/javascript')
const renderWorker = await retrieve('explorer render worker', new URL('pond-worker.js', explorerURL).href, 'text/javascript')
validateExplorer(explorer.body, bundle.body, renderWorker.body)

const health = await retrieve('worker health', `${config.worker}/health`, 'application/json', {
  origin: explorerURL.origin,
  maximumBytes: 20_000,
})
if (health.response.headers.get('access-control-allow-origin') !== explorerURL.origin) {
  throw new Error('FAIL worker health: production CORS origin changed')
}
validateHealth(JSON.parse(health.body))

const contributions = await retrieve(
  'public contribution calendar',
  `${config.worker}/v1/contributions/${encodeURIComponent(config.syntheticUser)}`,
  'application/json',
  { origin: explorerURL.origin, maximumBytes: 250_000 },
)
if (contributions.response.headers.get('access-control-allow-origin') !== explorerURL.origin) {
  throw new Error('FAIL contribution calendar: production CORS origin changed')
}
const cacheStatus = contributions.response.headers.get('x-koipond-cache') ?? ''
if (!['HIT', 'MISS', 'STALE'].includes(cacheStatus)) {
  throw new Error('FAIL contribution calendar: edge cache status is missing')
}
if (cacheStatus === 'STALE' && contributions.response.headers.get('x-koipond-degraded') !== 'upstream') {
  throw new Error('FAIL contribution calendar: stale response has no degraded-state marker')
}
const dayCount = validateContributions(JSON.parse(contributions.body))

const profileExplorer = new URL(config.explorer)
profileExplorer.searchParams.set('user', config.syntheticUser)
const [profilePage, profileReadme, profileSvg, profileState] = await Promise.all([
  retrieve('rendered github profile', config.profilePage, 'text/html'),
  retrieve('profile readme', config.profileReadme, 'text/plain'),
  retrieve('profile svg', config.profileSvg, 'image/svg+xml'),
  retrieve('profile state', config.profileState, 'application/json', { maximumBytes: 1_000_000 }),
])
validateProfilePresentation(profilePage.body, profileReadme.body, config.profileSvg, profileExplorer.href)
validateProfileDelivery(profileSvg.response.headers)
const state = validateProductionArtifacts(
  profileSvg.body,
  JSON.parse(profileState.body),
  release.action,
  config.syntheticUser,
  config.timezoneOffsetMinutes,
)

console.log(
  `PASS profile delivery  rendered README -> animated SVG -> verified state revision ${state.revision}`,
)
console.log(
  `PASS production contract  ${dayCount} public days  ` +
    `${release.action.repository}@${release.action.sha}`,
)
console.log('Privacy: fixed synthetic identity, no cookies, no visitor identifiers, no response bodies retained')
