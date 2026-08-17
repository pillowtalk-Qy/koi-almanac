import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { demoGrid } from './demo'
import { environmentFromParams } from './environment-query'
import { fetchGrid, fetchGridPublic } from './github'
import { plan } from './planner'
import { THEMES, themeForEnvironment } from './render/palette'
import { renderSVG, type RenderContext } from './render/svg'
import {
  finalizePondState,
  highlightedCells,
  parsePondGenerator,
  preparePondState,
  provenanceFor,
  serializePondState,
} from './state'
import { parseVideoQuery, renderVideo } from './video'
import type { Grid } from './types'

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    token: { type: 'string' },
    demo: { type: 'boolean', default: false },
    seed: { type: 'string' },
    theme: { type: 'string', default: 'both' },
    out: { type: 'string', default: 'dist' },
    video: { type: 'string' },
    state: { type: 'string' },
    environment: { type: 'boolean', default: false },
    date: { type: 'string' },
    time: { type: 'string' },
    'timezone-offset': { type: 'string' },
    latitude: { type: 'string' },
    longitude: { type: 'string' },
    season: { type: 'string' },
    'generator-repository': { type: 'string' },
    'generator-sha': { type: 'string' },
  },
})

const seed = values.seed ?? values.user ?? 'koi-almanac'

let grid: Grid
if (values.demo) {
  grid = demoGrid(seed)
} else {
  if (!values.user) {
    console.error('Usage: koi-almanac --user <login> [--token <pat>] | koi-almanac --demo [--seed <s>]')
    process.exit(1)
  }
  const token = values.token ?? process.env.GITHUB_TOKEN
  try {
    if (token) {
      grid = await fetchGrid(values.user, token)
    } else {
      console.log('No token, falling back to the public contributions page (levels only)')
      grid = await fetchGridPublic(values.user)
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

const environmentParams = new URLSearchParams()
if (values.environment) environmentParams.set('environment', 'auto')
if (values.date) environmentParams.set('date', values.date)
if (values.time) environmentParams.set('time', values.time)
if (values['timezone-offset']) environmentParams.set('timezone', values['timezone-offset'])
if (values.latitude) environmentParams.set('latitude', values.latitude)
if (values.longitude) environmentParams.set('longitude', values.longitude)
if (values.season) environmentParams.set('season', values.season)
const environment = environmentFromParams(environmentParams)
const themes = environment
  ? (['auto'] as const)
  : values.theme === 'both'
    ? (['light', 'dark'] as const)
    : ([values.theme] as ('light' | 'dark')[])
let previousState: unknown = null
if (values.state && existsSync(values.state)) {
  try {
    previousState = JSON.parse(readFileSync(values.state, 'utf8'))
  } catch {
    console.warn(`Ignoring invalid pond state: ${values.state}`)
  }
}
const owner = values.user ?? 'koi-almanac-demo'
const generatorOptionsPresent = Boolean(values['generator-repository'] || values['generator-sha'])
const generator = generatorOptionsPresent
  ? parsePondGenerator({ repository: values['generator-repository'], sha: values['generator-sha'] })
  : null
if (generatorOptionsPresent && !generator) {
  console.error('--generator-repository requires owner/repository and --generator-sha requires a 40-character SHA')
  process.exit(1)
}
const preparedState = values.state ? preparePondState(grid, owner, seed, previousState, generator ?? undefined) : null
const feedingPlan = plan(grid, seed, preparedState?.identities)
const nextState = preparedState ? finalizePondState(preparedState, feedingPlan) : null
const p = nextState ? plan(grid, seed, nextState.fish) : feedingPlan
const renderPlan = environment
  ? plan(grid, seed, nextState?.fish ?? preparedState?.identities, environment)
  : p

mkdirSync(values.out, { recursive: true })
const outputs: Record<string, string> = {}
for (const key of themes) {
  const theme = environment ? themeForEnvironment(environment) : THEMES[key as 'light' | 'dark']
  if (!theme) {
    console.error(`Unknown theme: ${key} (expected light | dark | both)`)
    process.exit(1)
  }
  const context: RenderContext = nextState
    ? { provenance: provenanceFor(nextState), highlightedCells: highlightedCells(grid, nextState) }
    : {}
  context.environment = environment
  const { svg, meta } = renderSVG(grid, renderPlan, theme, seed, context)
  const file = join(values.out, `koi-almanac-${key}.svg`)
  writeFileSync(file, svg)
  outputs[key] = svg
  console.log(
    `${file}  ${(meta.bytes / 1024).toFixed(1)} KB | ${meta.plankton} plankton, ${meta.fish} fish, ` +
      `${meta.duration}s loop${meta.turtle ? ', turtle 🐢' : ''}${meta.lotus ? ', lotus 🪷' : ''}`,
  )
}

if (values.video) {
  const [file, query] = values.video.split('?')
  const key = file.includes('dark') && outputs.dark ? 'dark' : themes[0]
  const loopDuration = renderSVG(
    grid,
    renderPlan,
    environment ? themeForEnvironment(environment) : THEMES[key as 'light' | 'dark'],
    seed,
    { environment },
  ).meta.duration
  await renderVideo(outputs[key], file, loopDuration, parseVideoQuery(query))
  console.log(`${file}  rendered from the ${key} theme`)
}

if (values.state && nextState) {
  mkdirSync(dirname(values.state) || '.', { recursive: true })
  writeFileSync(values.state, serializePondState(nextState))
  console.log(
    `${values.state}  pond revision ${nextState.revision}, ${nextState.fish.length} persistent fish, ` +
      `sha256:${nextState.proof.digest.slice(0, 12)}`,
  )
}

if (outputs.light && outputs.dark) {
  const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const preview = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Koi Almanac preview</title>
<style>
body{margin:0;padding:48px 20px 64px;background:radial-gradient(1200px 600px at 20% -10%,rgba(34,211,238,0.12),transparent 60%),radial-gradient(900px 500px at 90% 10%,rgba(52,211,153,0.08),transparent 60%),#051019;color:#e3f4fb;font-family:ui-sans-serif,system-ui,sans-serif;display:grid;gap:32px;justify-items:center}
header{display:grid;gap:10px;justify-items:center;text-align:center}
h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-0.02em}
h1 span{background:linear-gradient(100deg,#7ff3ff,#22d3ee 45%,#34d399);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:0;color:#82a9bc;font-size:14px}
section{width:100%;max-width:1000px;background:rgba(13,33,47,0.6);border:1px solid rgba(125,211,252,0.14);border-radius:18px;padding:16px;box-shadow:0 18px 50px rgba(0,0,0,0.35)}
h2{font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#22d3ee;margin:0 0 12px;font-family:ui-monospace,monospace}
img{width:100%;height:auto;display:block;border-radius:10px}
</style></head><body>
<header><h1>🎏 <span>Koi Almanac</span></h1><p>your contribution graph as a living, seasonal pond</p></header>
<section><h2>light</h2><img alt="light pond" src="${uri(outputs.light)}"></section>
<section><h2>dark · bioluminescent</h2><img alt="dark pond" src="${uri(outputs.dark)}"></section>
</body></html>`
  const file = join(values.out, 'preview.html')
  writeFileSync(file, preview)
  console.log(`${file}  (open in a browser to watch the animation)`)
}
