import { gridFromDays, type Day } from '../github'
import { deriveEnvironment, momentAtTimezone, momentFromText, type PondEnvironment } from '../environment'
import { plan } from '../planner'
import { THEMES, themeForEnvironment } from '../render/palette'
import { renderSVG } from '../render/svg'
import type { Grid, Plan } from '../types'

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
      - uses: pillowtalk-Qy/koi-almanac@e87abde44224bc375b8a62ca5791865ab98c78d0
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
let currentUser = ''
let pondSwapTimer: number | undefined
let pondTransitionRevision = 0

const pad = (value: number) => String(value).padStart(2, '0')

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
}

function selectedEnvironment(): PondEnvironment {
  return deriveEnvironment(momentFromText(date.value, time.value))
}

function renderAuto() {
  if (!currentGrid || !currentPlan) return
  if (live.checked) updateLiveInputs()
  const environment = selectedEnvironment()
  const environmentPlan = plan(currentGrid, currentUser, undefined, environment)
  svgs.auto = renderSVG(
    currentGrid,
    environmentPlan,
    themeForEnvironment(environment),
    currentUser,
    { environment },
  ).svg
  const clock = `${pad(Math.floor(environment.minuteOfDay / 60))}:${pad(environment.minuteOfDay % 60)}`
  momentLabel.textContent = `${environment.date} · ${clock} HKT · ${environment.season} · ${environment.phase}`
  for (const button of document.querySelectorAll<HTMLButtonElement>('.season-jump')) {
    button.classList.toggle('on', button.dataset.season === environment.season)
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.phase-jump')) {
    button.classList.toggle('on', button.dataset.phase === environment.phase)
  }
}

function mountPond(mode: ViewMode) {
  pond.innerHTML = svgs[mode]
  const svg = pond.querySelector('svg')
  if (svg) {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
  }
  download.href = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgs[mode])))}`
  download.download = `koi-almanac-${mode}.svg`
}

function show(mode: ViewMode, animate = false) {
  active = mode
  if (mode === 'auto') renderAuto()
  for (const b of tabs.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.theme === mode)
  }
  document.body.classList.toggle('fixed-environment', mode !== 'auto')

  const revision = ++pondTransitionRevision
  if (pondSwapTimer !== undefined) window.clearTimeout(pondSwapTimer)
  pond.classList.remove('pond-leaving', 'pond-entering')
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

async function generate(user: string) {
  button.disabled = true
  status.removeAttribute('data-tone')
  status.textContent = 'Fetching contributions and simulating the pond...'
  result.hidden = true
  try {
    const { grid, stale, fetchedAt } = await fetchGrid(user)
    const p = plan(grid, user)
    currentGrid = grid
    currentPlan = p
    currentUser = user
    svgs.light = renderSVG(grid, p, THEMES.light, user).svg
    svgs.dark = renderSVG(grid, p, THEMES.dark, user).svg
    renderAuto()
    if (stale) {
      const snapshot = fetchedAt ? ` from ${new Date(fetchedAt).toLocaleString()}` : ''
      status.dataset.tone = 'warning'
      status.textContent = `GitHub is temporarily unavailable. Showing the last successful contribution snapshot${snapshot}.`
    } else {
      status.removeAttribute('data-tone')
      status.textContent = ''
    }
    result.hidden = false
    show(active)
    fillInstall(user)
    syncURL()
  } catch (err) {
    status.dataset.tone = 'error'
    status.textContent = err instanceof Error ? err.message : String(err)
  } finally {
    button.disabled = false
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
  if (b?.dataset.theme) show(b.dataset.theme as ViewMode, true)
})

live.addEventListener('change', () => {
  if (live.checked) updateLiveInputs()
  if (active === 'auto') show('auto', true)
  syncURL()
})

for (const control of [date, time]) {
  control.addEventListener('input', () => {
    live.checked = false
    if (active === 'auto') show('auto', true)
    syncURL()
  })
}

document.querySelectorAll<HTMLButtonElement>('.season-jump').forEach(button => {
  button.addEventListener('click', () => {
    const year = date.value.slice(0, 4) || String(momentAtTimezone(new Date()).year)
    date.value = `${year}-${button.dataset.monthDay}`
    live.checked = false
    show('auto', true)
    syncURL()
  })
})

document.querySelectorAll<HTMLButtonElement>('.phase-jump').forEach(button => {
  button.addEventListener('click', () => {
    time.value = button.dataset.time ?? time.value
    live.checked = false
    show('auto', true)
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
setInterval(() => {
  if (live.checked && active === 'auto' && currentGrid) show('auto')
}, 60_000)
if (preset) {
  input.value = preset
  void generate(preset)
}
