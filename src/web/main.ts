import { gridFromDays, type Day } from '../github'
import { deriveEnvironment, momentAtTimezone, momentFromText, type PondEnvironment } from '../environment'
import type { Grid, Plan } from '../types'
import {
  runRenderJob,
  type AutoRenderResult,
  type FixedRenderResult,
  type RenderJob,
  type RenderJobResult,
  type RenderWorkerRequest,
  type RenderWorkerResponse,
} from './render-jobs'

const CONTRIBUTION_API = 'https://koi-almanac-contributions.intentflow-inspector.workers.dev'
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const form = $<HTMLFormElement>('form')
const input = $<HTMLInputElement>('user')
const button = $<HTMLButtonElement>('go')
const status = $<HTMLParagraphElement>('status')
const result = $<HTMLDivElement>('result')
const pond = $<HTMLDivElement>('pond')
const tabs = $<HTMLDivElement>('tabs')
const download = $<HTMLAnchorElement>('download')
const installLink = $<HTMLAnchorElement>('install-link')
const installNote = $<HTMLSpanElement>('install-note')
const repoLink = $<HTMLAnchorElement>('repo-link')
const snippet = $<HTMLElement>('snippet')
const copy = $<HTMLButtonElement>('copy')
const live = $<HTMLInputElement>('live')
const date = $<HTMLInputElement>('date')
const time = $<HTMLInputElement>('time')
const momentLabel = $<HTMLSpanElement>('moment-label')
const yearTimeline = $<HTMLInputElement>('year-timeline')
const dayTimeline = $<HTMLInputElement>('day-timeline')
const yearTimelineValue = $<HTMLOutputElement>('year-timeline-value')
const dayTimelineValue = $<HTMLOutputElement>('day-timeline-value')

const workflowFor = () => `name: koi-almanac
on:
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: pillowtalk-Qy/koi-almanac@ceb9404b4136a94e7778a6395d431bacdaa9dc7a
        with:
          github_user_name: ${'$'}{{ github.repository_owner }}
          outputs: |
            dist/koi-almanac.svg?environment=auto&timezone=480&latitude=22.3193&longitude=114.1694
      - uses: peaceiris/actions-gh-pages@84c30a85c19949d7eee79c4ff27748b70285e453 # v4.1.0
        with:
          github_token: ${'$'}{{ secrets.GITHUB_TOKEN }}
          publish_branch: output
          publish_dir: ./dist
`

const snippetFor = (user: string) => `<a href="https://pillowtalk-qy.github.io/koi-almanac/?user=${encodeURIComponent(user)}">
  <img alt="Koi Almanac" src="https://raw.githubusercontent.com/${user}/${user}/output/koi-almanac.svg">
</a>
<br>
<sub>This pond follows Hong Kong time and season. Contributions feed it; its fish remember. · <a href="https://raw.githubusercontent.com/${user}/${user}/output/pond-state.json">verify state</a></sub>`

function fillInstall(user: string) {
  const params = new URLSearchParams({
    filename: '.github/workflows/koi-almanac.yml',
    value: workflowFor(),
  })
  installLink.href = `https://github.com/${user}/${user}/new/main?${params}`
  installNote.textContent = `opens ${user}/${user} prefilled, just press commit`
  repoLink.href = `https://github.com/new?name=${encodeURIComponent(user)}`
  snippet.textContent = snippetFor(user)
}

interface ApiResponse {
  contributions: { date: string; count: number; level: Day['level'] }[]
  fetchedAt?: string
}

interface GridResponse {
  grid: Grid
  stale: boolean
  fetchedAt?: string
}

const retryableStatus = (statusCode: number) => statusCode === 429 || statusCode >= 500
const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

async function contributionRequest(user: string): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${CONTRIBUTION_API}/v1/contributions/${encodeURIComponent(user)}`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!retryableStatus(response.status) || attempt === 2) return response
      await response.body?.cancel()
    } catch (error) {
      lastError = error
      if (attempt === 2) break
    }
    await wait(350 * 2 ** attempt)
  }
  throw lastError instanceof Error ? lastError : new Error('Contribution service unavailable')
}

async function fetchGrid(user: string): Promise<GridResponse> {
  const res = await contributionRequest(user)
  if (!res.ok) {
    if (res.status === 404) throw new Error(`User not found: ${user}`)
    throw new Error("GitHub's contribution service is temporarily unavailable after several retries. Please try again shortly.")
  }
  const json = (await res.json()) as ApiResponse
  if (!json.contributions?.length) throw new Error(`No contributions found for ${user}`)
  return {
    grid: gridFromDays(json.contributions),
    stale: res.headers.get('X-Koipond-Cache') === 'STALE',
    fetchedAt: res.headers.get('X-Koipond-Fetched-At') ?? json.fetchedAt,
  }
}

type ViewMode = 'auto' | 'light' | 'dark'

const svgs: Record<ViewMode, string> = { auto: '', light: '', dark: '' }
let active: ViewMode = 'auto'
let currentGrid: Grid | null = null
let currentPlan: Plan | null = null
let committedAutoPlan: Plan | null = null
let currentUser = ''
let pondSwapTimer: number | undefined
let pondTransitionRevision = 0
let environmentFrame: number | undefined
let environmentPreviewTimer: number | undefined
let lastEnvironmentPreview = -Infinity
let generationRevision = 0

const ENVIRONMENT_PREVIEW_INTERVAL = 80
const PERSISTENT_POND_MOTION = /^(?:fp\d+|turtle(?:-.+)?)$/
const ecologyMotionStartedAt = performance.now()

let renderWorker: Worker | null = null
let renderWorkerRevision = 0
const pendingRenderJobs = new Map<number, {
  resolve: (result: RenderJobResult) => void
  reject: (error: Error) => void
}>()

function disableRenderWorker(error: Error) {
  renderWorker?.terminate()
  renderWorker = null
  document.documentElement.dataset.renderWorker = 'fallback'
  for (const pending of pendingRenderJobs.values()) pending.reject(error)
  pendingRenderJobs.clear()
}

if ('Worker' in window) {
  try {
    renderWorker = new Worker(new URL('pond-worker.js', document.baseURI))
    document.documentElement.dataset.renderWorker = 'starting'
    renderWorker.onmessage = (event: MessageEvent<RenderWorkerResponse>) => {
      const pending = pendingRenderJobs.get(event.data.revision)
      if (!pending) return
      pendingRenderJobs.delete(event.data.revision)
      if ('error' in event.data) pending.reject(new Error(event.data.error))
      else {
        document.documentElement.dataset.renderWorker = 'active'
        pending.resolve(event.data.result)
      }
    }
    renderWorker.onerror = () => disableRenderWorker(new Error('Background renderer failed to load'))
  } catch {
    renderWorker = null
    document.documentElement.dataset.renderWorker = 'fallback'
  }
} else {
  document.documentElement.dataset.renderWorker = 'fallback'
}

async function renderPondJob<T extends RenderJobResult>(job: RenderJob): Promise<T> {
  if (!renderWorker) return runRenderJob(job) as T
  const revision = ++renderWorkerRevision
  const request: RenderWorkerRequest = { revision, job }
  try {
    return await new Promise<T>((resolve, reject) => {
      pendingRenderJobs.set(revision, {
        resolve: result => resolve(result as T),
        reject,
      })
      renderWorker?.postMessage(request)
    })
  } catch {
    return runRenderJob(job) as T
  }
}

interface PondMotionPhase {
  phase: number
}

const pad = (value: number) => String(value).padStart(2, '0')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const monthDayFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

function daysInYear(year: number): number {
  return Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MILLISECONDS)
}

function selectedDate(): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) return null
  const selected = new Date(`${date.value}T00:00:00Z`)
  return Number.isNaN(selected.getTime()) ? null : selected
}

function syncEnvironmentTimelines() {
  const selected = selectedDate()
  if (selected) {
    const year = selected.getUTCFullYear()
    const dayOfYear = Math.floor((selected.getTime() - Date.UTC(year, 0, 1)) / DAY_MILLISECONDS) + 1
    yearTimeline.max = String(daysInYear(year))
    yearTimeline.value = String(dayOfYear)
    yearTimelineValue.textContent = monthDayFormatter.format(selected)
    yearTimeline.setAttribute('aria-valuetext', `${yearTimelineValue.textContent}, ${year}`)
  }

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time.value)
  if (timeMatch) {
    const minute = Number(timeMatch[1]) * 60 + Number(timeMatch[2])
    dayTimeline.value = String(minute)
    dayTimelineValue.textContent = time.value
    dayTimeline.setAttribute('aria-valuetext', time.value)
  }
}

function syncURL() {
  const params = new URLSearchParams()
  const user = currentUser || input.value.trim()
  if (user) params.set('user', user)
  if (!live.checked) {
    params.set('date', date.value)
    params.set('time', time.value)
  }
  history.replaceState(null, '', params.size > 0 ? `?${params}` : location.pathname)
}

function updateLiveInputs() {
  const moment = momentAtTimezone(new Date())
  date.value = `${moment.year}-${pad(moment.month)}-${pad(moment.day)}`
  time.value = `${pad(Math.floor(moment.minuteOfDay / 60))}:${pad(moment.minuteOfDay % 60)}`
  syncEnvironmentTimelines()
}

function selectedEnvironment(): PondEnvironment {
  return deriveEnvironment(momentFromText(date.value, time.value))
}

async function renderAuto(preview = false, revision = pondTransitionRevision): Promise<boolean> {
  if (!currentGrid || !currentPlan) return false
  if (live.checked) updateLiveInputs()
  else syncEnvironmentTimelines()
  const environment = selectedEnvironment()
  const grid = currentGrid
  const user = currentUser
  const rendered = await renderPondJob<AutoRenderResult>({
    kind: 'auto',
    grid,
    user,
    environment,
    plan: preview && committedAutoPlan ? committedAutoPlan : undefined,
  })
  if (revision !== pondTransitionRevision || grid !== currentGrid || user !== currentUser || active !== 'auto') {
    return false
  }
  if (!preview) committedAutoPlan = rendered.plan
  svgs.auto = rendered.svg
  const clock = `${pad(Math.floor(environment.minuteOfDay / 60))}:${pad(environment.minuteOfDay % 60)}`
  momentLabel.textContent = `${environment.date} · ${clock} HKT · ${environment.season} · ${environment.phase}`
  for (const button of document.querySelectorAll<HTMLButtonElement>('.season-jump')) {
    button.classList.toggle('on', button.dataset.season === environment.season)
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.phase-jump')) {
    button.classList.toggle('on', button.dataset.phase === environment.phase)
  }
  return true
}

function scheduleEnvironmentPreview() {
  if (environmentPreviewTimer !== undefined || environmentFrame !== undefined) return
  const wait = Math.max(0, ENVIRONMENT_PREVIEW_INTERVAL - (performance.now() - lastEnvironmentPreview))
  environmentPreviewTimer = window.setTimeout(() => {
    environmentPreviewTimer = undefined
    environmentFrame = window.requestAnimationFrame(() => {
      environmentFrame = undefined
      lastEnvironmentPreview = performance.now()
      if (active === 'auto') showPond('auto', false, true)
      syncURL()
    })
  }, wait)
}

function finishEnvironmentPreview() {
  if (environmentPreviewTimer !== undefined) {
    window.clearTimeout(environmentPreviewTimer)
    environmentPreviewTimer = undefined
  }
  if (environmentFrame !== undefined) {
    window.cancelAnimationFrame(environmentFrame)
    environmentFrame = undefined
  }
  lastEnvironmentPreview = performance.now()
  if (active === 'auto') showPond('auto', true)
  syncURL()
}

function pondMotionPhases(): Map<string, PondMotionPhase> {
  const phases = new Map<string, PondMotionPhase>()
  for (const animation of pond.getAnimations({ subtree: true })) {
    const name = 'animationName' in animation ? String(animation.animationName) : ''
    if (!PERSISTENT_POND_MOTION.test(name) || phases.has(name)) continue
    const currentTime = Number(animation.currentTime)
    const duration = Number(animation.effect?.getTiming().duration)
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) continue
    phases.set(name, {
      phase: ((currentTime % duration) + duration) % duration / duration,
    })
  }
  return phases
}

function restorePondMotion(phases: Map<string, PondMotionPhase>) {
  const ecologyTime = performance.now() - ecologyMotionStartedAt
  for (const animation of pond.getAnimations({ subtree: true })) {
    const name = 'animationName' in animation ? String(animation.animationName) : ''
    const previous = phases.get(name)
    if (!previous) {
      if (!PERSISTENT_POND_MOTION.test(name)) animation.currentTime = ecologyTime
      continue
    }
    const duration = Number(animation.effect?.getTiming().duration)
    if (!Number.isFinite(duration) || duration <= 0) continue
    animation.currentTime = previous.phase * duration
  }
}

function mountPond(mode: ViewMode) {
  const motionPhases = pondMotionPhases()
  pond.innerHTML = svgs[mode]
  const svg = pond.querySelector('svg')
  if (svg) {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
  }
  restorePondMotion(motionPhases)
  download.href = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgs[mode])))}`
  download.download = `koi-almanac-${mode}.svg`
}

async function show(mode: ViewMode, animate = false, preview = false): Promise<void> {
  const revision = ++pondTransitionRevision
  active = mode
  if (pondSwapTimer !== undefined) window.clearTimeout(pondSwapTimer)
  pond.classList.remove('pond-leaving', 'pond-entering')
  for (const b of tabs.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.theme === mode)
  }
  document.body.classList.toggle('fixed-environment', mode !== 'auto')
  if (mode === 'auto' && !(await renderAuto(preview, revision))) return
  if (revision !== pondTransitionRevision || active !== mode) return

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const shouldTransition = animate && Boolean(pond.querySelector('svg')) && !reduceMotion
  if (!shouldTransition) {
    pond.removeAttribute('aria-busy')
    mountPond(mode)
    return
  }

  pond.setAttribute('aria-busy', 'true')
  void pond.offsetWidth
  pond.classList.add('pond-leaving')
  pondSwapTimer = window.setTimeout(() => {
    if (revision !== pondTransitionRevision) return
    pondSwapTimer = undefined
    mountPond(mode)
    pond.classList.remove('pond-leaving')
    pond.classList.add('pond-entering')
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (revision !== pondTransitionRevision) return
        pond.classList.remove('pond-entering')
        pond.removeAttribute('aria-busy')
      })
    })
  }, 210)
}

function showPond(mode: ViewMode, animate = false, preview = false) {
  void show(mode, animate, preview).catch(error => {
    status.dataset.tone = 'error'
    status.textContent = error instanceof Error ? error.message : String(error)
  })
}

async function generate(user: string) {
  const revision = ++generationRevision
  button.disabled = true
  status.removeAttribute('data-tone')
  status.textContent = 'Fetching contributions and simulating the pond...'
  result.hidden = true
  try {
    const { grid, stale, fetchedAt } = await fetchGrid(user)
    const rendered = await renderPondJob<FixedRenderResult>({ kind: 'fixed', grid, user })
    if (revision !== generationRevision) return
    currentGrid = grid
    currentPlan = rendered.plan
    committedAutoPlan = null
    currentUser = user
    svgs.light = rendered.light
    svgs.dark = rendered.dark
    if (stale) {
      const snapshot = fetchedAt ? ` from ${new Date(fetchedAt).toLocaleString()}` : ''
      status.dataset.tone = 'warning'
      status.textContent = `GitHub is temporarily unavailable. Showing the last successful contribution snapshot${snapshot}.`
    } else {
      status.removeAttribute('data-tone')
      status.textContent = ''
    }
    result.hidden = false
    await show(active)
    fillInstall(user)
    syncURL()
  } catch (err) {
    status.dataset.tone = 'error'
    status.textContent = err instanceof Error ? err.message : String(err)
  } finally {
    if (revision === generationRevision) button.disabled = false
  }
}

form.addEventListener('submit', e => {
  e.preventDefault()
  const user = input.value.trim()
  if (user) void generate(user)
})

document.querySelectorAll<HTMLButtonElement>('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const user = chip.dataset.user ?? ''
    if (user) {
      input.value = user
      void generate(user)
    }
  })
})

tabs.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button')
  if (b?.dataset.theme) showPond(b.dataset.theme as ViewMode, true)
})

live.addEventListener('change', () => {
  if (live.checked) updateLiveInputs()
  if (active === 'auto') showPond('auto', true)
  syncURL()
})

for (const control of [date, time]) {
  control.addEventListener('input', () => {
    live.checked = false
    syncEnvironmentTimelines()
    if (active === 'auto') showPond('auto', true)
    syncURL()
  })
}

yearTimeline.addEventListener('input', () => {
  const selected = selectedDate()
  const year = selected?.getUTCFullYear() ?? momentAtTimezone(new Date()).year
  const dayOfYear = Math.max(1, Math.min(daysInYear(year), Number(yearTimeline.value)))
  date.value = new Date(Date.UTC(year, 0, dayOfYear)).toISOString().slice(0, 10)
  live.checked = false
  syncEnvironmentTimelines()
  scheduleEnvironmentPreview()
})

dayTimeline.addEventListener('input', () => {
  const minute = Math.max(0, Math.min(1_439, Number(dayTimeline.value)))
  time.value = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
  live.checked = false
  syncEnvironmentTimelines()
  scheduleEnvironmentPreview()
})

for (const timeline of [yearTimeline, dayTimeline]) {
  timeline.addEventListener('change', finishEnvironmentPreview)
  timeline.addEventListener('pointercancel', finishEnvironmentPreview)
}

document.querySelectorAll<HTMLButtonElement>('.season-jump').forEach(button => {
  button.addEventListener('click', () => {
    const year = date.value.slice(0, 4) || String(momentAtTimezone(new Date()).year)
    date.value = `${year}-${button.dataset.monthDay}`
    live.checked = false
    syncEnvironmentTimelines()
    showPond('auto', true)
    syncURL()
  })
})

document.querySelectorAll<HTMLButtonElement>('.phase-jump').forEach(button => {
  button.addEventListener('click', () => {
    time.value = button.dataset.time ?? time.value
    live.checked = false
    syncEnvironmentTimelines()
    showPond('auto', true)
    syncURL()
  })
})

copy.addEventListener('click', () => {
  void navigator.clipboard.writeText(snippet.textContent ?? '').then(() => {
    copy.textContent = 'Copied!'
    setTimeout(() => {
      copy.textContent = 'Copy snippet'
    }, 1500)
  })
})

const initialParams = new URLSearchParams(location.search)
const preset = initialParams.get('user')
updateLiveInputs()
const presetDate = initialParams.get('date')
const presetTime = initialParams.get('time')
if (presetDate && /^\d{4}-\d{2}-\d{2}$/.test(presetDate)) date.value = presetDate
if (presetTime && /^\d{2}:\d{2}$/.test(presetTime)) time.value = presetTime
if (presetDate || presetTime) live.checked = false
syncEnvironmentTimelines()
setInterval(() => {
  if (live.checked && active === 'auto' && currentGrid) showPond('auto')
}, 60_000)
if (preset) {
  input.value = preset
  void generate(preset)
}
