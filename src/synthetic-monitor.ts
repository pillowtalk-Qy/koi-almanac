import { verifyPondState, type PondGenerator, type PondProvenance, type PondState } from './state'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function validateExplorer(html: string, javascript: string): void {
  assert(html.includes('<title>Koi Almanac:'), 'Explorer title is missing')
  assert(html.includes('<form id="form">'), 'Explorer form is missing')
  assert(html.includes('<div id="pond"></div>'), 'Explorer pond mount is missing')
  assert(html.includes('<script src="demo.js" defer></script>'), 'Explorer script reference is missing')
  assert(javascript.length > 50_000, 'Explorer bundle is unexpectedly small')
  assert(
    javascript.includes('koi-almanac-contributions.intentflow-inspector.workers.dev'),
    'Explorer bundle does not reference the production contribution Worker',
  )
}

export function validateHealth(value: unknown): void {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Health response is not an object')
  const health = value as Record<string, unknown>
  assert(health.ok === true, 'Worker health is not OK')
  assert(health.source === 'github.com', 'Worker health source changed')
  assert(health.logging === 'disabled', 'Worker no longer declares logging disabled')
}

export function validateContributions(value: unknown, now = new Date()): number {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Contribution response is not an object')
  const payload = value as Record<string, unknown>
  assert(payload.source === 'github.com/public-contribution-calendar', 'Contribution source changed')
  assert(Array.isArray(payload.contributions), 'Contribution response has no calendar')
  assert(payload.contributions.length >= 300 && payload.contributions.length <= 380, 'Contribution calendar length is implausible')

  const dates = new Set<string>()
  let previous = ''
  for (const entry of payload.contributions) {
    assert(entry !== null && typeof entry === 'object' && !Array.isArray(entry), 'Contribution day is malformed')
    const day = entry as Record<string, unknown>
    assert(typeof day.date === 'string' && ISO_DATE.test(day.date), 'Contribution date is malformed')
    assert(Number.isInteger(day.count) && Number(day.count) >= 0, 'Contribution count is malformed')
    assert(Number.isInteger(day.level) && Number(day.level) >= 0 && Number(day.level) <= 4, 'Contribution level is malformed')
    assert(day.date > previous, 'Contribution dates are duplicated or unsorted')
    previous = day.date
    dates.add(day.date)
  }

  assert(dates.size === payload.contributions.length, 'Contribution dates are duplicated')
  const latest = new Date(`${previous}T00:00:00Z`).getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  assert(latest <= today && latest >= today - 2 * 86_400_000, 'Contribution calendar is stale')
  return payload.contributions.length
}

function decodeXMLText(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function svgMetadata(svg: string, id: string): unknown {
  const metadata = svg.match(new RegExp(`<metadata id="${id}">([^<]+)<\\/metadata>`))?.[1]
  assert(metadata, `Profile SVG has no ${id} metadata`)
  let parsed: unknown
  try {
    parsed = JSON.parse(decodeXMLText(metadata))
  } catch {
    throw new Error(`Profile SVG ${id} metadata is not valid JSON`)
  }
  assert(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), `Profile SVG ${id} is malformed`)
  return parsed
}

export function validateProductionArtifacts(
  svg: string,
  stateValue: unknown,
  expectedGenerator: PondGenerator,
  expectedOwner: string,
  timezoneOffsetMinutes = 480,
  now = new Date(),
): PondState {
  assert(svg.startsWith('<svg ') && svg.includes('viewBox="0 0 '), 'Profile SVG is malformed')
  assert(svg.length > 50_000, 'Profile SVG is unexpectedly small')
  const state = verifyPondState(stateValue)
  assert(state, 'Profile state failed its SHA-256 verification')
  assert(state.owner === expectedOwner, `Profile state owner is ${state.owner}, expected ${expectedOwner}`)
  const stateDate = new Date(`${state.updatedOn}T00:00:00Z`).getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  assert(stateDate <= today && stateDate >= today - 2 * 86_400_000, 'Profile state is stale')
  assert(
    state.generator?.repository === expectedGenerator.repository && state.generator.sha === expectedGenerator.sha,
    'Profile state was not produced by the released generator SHA',
  )

  const provenance = svgMetadata(svg, 'koipond-provenance') as PondProvenance
  assert(provenance.owner === state.owner, 'SVG and state owners differ')
  assert(provenance.revision === state.revision, 'SVG and state revisions differ')
  assert(provenance.updatedOn === state.updatedOn, 'SVG and state update dates differ')
  assert(provenance.sourceDigest === state.proof.sourceDigest, 'SVG and state source digests differ')
  assert(provenance.previousDigest === state.proof.previousDigest, 'SVG and state previous digests differ')
  assert(provenance.stateDigest === state.proof.digest, 'SVG and state digests differ')
  assert(
    provenance.generator?.repository === expectedGenerator.repository &&
      provenance.generator.sha === expectedGenerator.sha,
    'SVG provenance was not produced by the released generator SHA',
  )

  const environment = svgMetadata(svg, 'koipond-environment') as Record<string, unknown>
  const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60_000)
  const expectedDate = shifted.toISOString().slice(0, 10)
  const expectedMinute = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  assert(environment.date === expectedDate, 'Profile environment snapshot is stale')
  assert(environment.timezoneOffsetMinutes === timezoneOffsetMinutes, 'Profile environment timezone changed')
  assert(typeof environment.minuteOfDay === 'number', 'Profile environment time is malformed')
  const minuteDistance = Math.abs(environment.minuteOfDay - expectedMinute)
  const circularMinuteDistance = Math.min(minuteDistance, 1_440 - minuteDistance)
  assert(circularMinuteDistance <= 150, 'Profile environment snapshot is older than 150 minutes')
  return state
}
