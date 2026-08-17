const CACHE_TTL_SECONDS = 15 * 60
const CALENDAR_LOOKBACK_DAYS = 370
const MAX_CALENDAR_BYTES = 2_000_000
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/

type ContributionLevel = 0 | 1 | 2 | 3 | 4

interface ContributionDay {
  date: string
  count: number
  level: ContributionLevel
}

interface CalendarRange {
  from: string
  to: string
}

class HTTPError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function contributionRanges(today = new Date()): CalendarRange[] {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - CALENDAR_LOOKBACK_DAYS)
  const ranges: CalendarRange[] = []
  let cursor = start

  while (cursor <= end) {
    const endOfYear = new Date(Date.UTC(cursor.getUTCFullYear(), 11, 31))
    const rangeEnd = endOfYear < end ? endOfYear : end
    ranges.push({ from: formatDate(cursor), to: formatDate(rangeEnd) })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear() + 1, 0, 1))
  }

  return ranges
}

class DayCollector implements HTMLRewriterElementContentHandlers {
  constructor(private readonly days: Map<string, ContributionDay>) {}

  element(element: Element) {
    const id = element.getAttribute('id')
    const date = element.getAttribute('data-date')
    const rawLevel = Number(element.getAttribute('data-level'))
    if (!id || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    const level = Math.max(0, Math.min(4, Number.isFinite(rawLevel) ? rawLevel : 0)) as ContributionLevel
    this.days.set(id, { date, count: 0, level })
  }
}

class TooltipCollector implements HTMLRewriterElementContentHandlers {
  private currentDay = ''
  private textContent = ''

  constructor(private readonly days: Map<string, ContributionDay>) {}

  element(element: Element) {
    this.currentDay = element.getAttribute('for') ?? ''
    this.textContent = ''
  }

  text(text: Text) {
    this.textContent += text.text
    if (!text.lastInTextNode) return
    const day = this.days.get(this.currentDay)
    if (!day) return
    const count = this.textContent.match(/([\d,]+) contributions?\b/i)?.[1]
    day.count = count ? Number(count.replaceAll(',', '')) : 0
  }
}

async function consumeBounded(response: Response): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new HTTPError(502, 'GitHub returned an empty contribution calendar')
  let received = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received > MAX_CALENDAR_BYTES) {
        await reader.cancel('Contribution calendar exceeded the size limit')
        throw new HTTPError(502, 'GitHub returned an oversized contribution calendar')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function parseContributionCalendar(response: Response): Promise<ContributionDay[]> {
  const days = new Map<string, ContributionDay>()
  const transformed = new HTMLRewriter()
    .on('td.ContributionCalendar-day', new DayCollector(days))
    .on('tool-tip[for^="contribution-day-component-"]', new TooltipCollector(days))
    .transform(response)
  await consumeBounded(transformed)
  return [...days.values()]
}

async function fetchCalendarRange(username: string, range: CalendarRange): Promise<ContributionDay[]> {
  const url = new URL(`/users/${encodeURIComponent(username)}/contributions`, 'https://github.com')
  url.searchParams.set('from', range.from)
  url.searchParams.set('to', range.to)
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'koi-almanac-contributions/1.0 (+https://github.com/pillowtalk-Qy/koi-almanac)',
    },
  })
  if (response.status === 404) throw new HTTPError(404, `GitHub user not found: ${username}`)
  if (!response.ok) throw new HTTPError(502, `GitHub contribution calendar responded ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) throw new HTTPError(502, 'GitHub returned an unexpected response')
  return parseContributionCalendar(response)
}

async function fetchContributions(username: string): Promise<ContributionDay[]> {
  const ranges = contributionRanges()
  const calendars = await Promise.all(ranges.map(range => fetchCalendarRange(username, range)))
  const byDate = new Map<string, ContributionDay>()
  const firstDate = ranges[0].from
  const lastDate = ranges.at(-1)?.to ?? firstDate
  for (const day of calendars.flat()) {
    if (day.date >= firstDate && day.date <= lastDate) byDate.set(day.date, day)
  }
  const contributions = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (contributions.length === 0) throw new HTTPError(404, `No public contributions found for ${username}`)
  return contributions
}

function allowedOrigin(request: Request, env: Env): string | null | undefined {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  if (origin === env.ALLOWED_ORIGIN || LOCAL_ORIGIN.test(origin)) return origin
  return undefined
}

function responseHeaders(origin: string | null, cacheStatus?: 'HIT' | 'MISS'): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Access-Control-Max-Age', '86400')
    headers.set('Vary', 'Origin')
  }
  if (cacheStatus) headers.set('X-Koipond-Cache', cacheStatus)
  return headers
}

function jsonResponse(
  data: unknown,
  status: number,
  origin: string | null,
  cacheStatus?: 'HIT' | 'MISS',
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin, cacheStatus),
  })
}

function withRequestHeaders(response: Response, origin: string | null, cacheStatus: 'HIT' | 'MISS'): Response {
  const headers = new Headers(response.headers)
  const requestHeaders = responseHeaders(origin, cacheStatus)
  for (const [name, value] of requestHeaders) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function contributionResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  username: string,
  origin: string | null,
): Promise<Response> {
  const canonicalUser = username.toLowerCase()
  const requestURL = new URL(request.url)
  const cacheKey = new Request(`${requestURL.origin}/v1/contributions/${canonicalUser}`)
  const cache = await caches.open('koi-almanac-contributions-v1')
  const cached = await cache.match(cacheKey)
  if (cached) return withRequestHeaders(cached, origin, 'HIT')

  const rateLimit = await env.CONTRIBUTION_RATE_LIMIT.limit({ key: 'github-contribution-calendar' })
  if (!rateLimit.success) return jsonResponse({ error: 'Contribution service is busy; retry shortly' }, 429, origin)

  const contributions = await fetchContributions(username)
  const response = jsonResponse(
    { contributions, source: 'github.com/public-contribution-calendar' },
    200,
    null,
  )
  response.headers.set('Cache-Control', `public, max-age=300, s-maxage=${CACHE_TTL_SECONDS}`)
  ctx.waitUntil(cache.put(cacheKey, response.clone()))
  return withRequestHeaders(response, origin, 'MISS')
}

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = allowedOrigin(request, env)
  if (origin === undefined) return jsonResponse({ error: 'Origin not allowed' }, 403, null)

  const url = new URL(request.url)
  if (request.method === 'OPTIONS') {
    if (!request.headers.has('Origin')) return jsonResponse({ error: 'Origin required' }, 400, null)
    return new Response(null, { status: 204, headers: responseHeaders(origin) })
  }
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405, origin)

  if (url.pathname === '/health') {
    return jsonResponse({ ok: true, source: 'github.com', logging: 'disabled' }, 200, origin)
  }

  const match = url.pathname.match(/^\/v1\/contributions\/([^/]+)$/)
  const username = match ? decodeURIComponent(match[1]) : ''
  if (!USERNAME.test(username)) {
    return jsonResponse({ error: match ? 'Invalid GitHub username' : 'Not found' }, match ? 400 : 404, origin)
  }

  try {
    return await contributionResponse(request, env, ctx, username, origin)
  } catch (error) {
    if (error instanceof HTTPError) return jsonResponse({ error: error.message }, error.status, origin)
    return jsonResponse({ error: 'Contribution service unavailable' }, 502, origin)
  }
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>
