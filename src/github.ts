import { DAY_MS } from './util'
import type { Cell, Grid } from './types'

const QUERY = `query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
            weekday
          }
        }
      }
    }
  }
}`

const LEVELS: Record<string, Cell['level']> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
}

interface ApiDay {
  date: string
  contributionCount: number
  contributionLevel: string
  weekday: number
}

export interface Day {
  date: string
  count: number
  level: Cell['level']
}

const retryableStatus = (status: number) => status === 429 || status >= 500

export async function fetchWithRetry(input: string | URL, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(input, init)
      if (!retryableStatus(response.status) || attempt === attempts - 1) return response
      await response.body?.cancel()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
  }
  throw lastError instanceof Error ? lastError : new Error('GitHub request failed')
}

export function parsePublicContributionDays(html: string): Day[] {
  const days: Day[] = []
  for (const match of html.matchAll(/<td\b[^>]*>/g)) {
    const tag = match[0]
    const date = /\bdata-date="(\d{4}-\d{2}-\d{2})"/.exec(tag)?.[1]
    const level = /\bdata-level="([0-4])"/.exec(tag)?.[1]
    if (!date || level === undefined) continue
    const parsed = Number(level) as Cell['level']
    days.push({ date, count: parsed, level: parsed })
  }
  return days
}

export function gridFromDays(days: Day[]): Grid {
  if (days.length === 0) throw new Error('Cannot build a contribution grid without days')
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const origin = new Date(sorted[0].date)
  const originSunday = origin.getTime() - origin.getUTCDay() * DAY_MS
  const cells: Cell[] = sorted.map(({ date, count, level }) => {
    const d = new Date(date)
    const week = Math.floor(Math.round((d.getTime() - originSunday) / DAY_MS) / 7)
    return { week, day: d.getUTCDay(), date, count, level }
  })
  return { weeks: Math.max(...cells.map(c => c.week)) + 1, cells }
}

export async function fetchGrid(login: string, token: string): Promise<Grid> {
  const res = await fetchWithRetry('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'koi-almanac',
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  })
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as {
    errors?: { message: string }[]
    data?: { user: { contributionsCollection: { contributionCalendar: { weeks: { contributionDays: ApiDay[] }[] } } } | null }
  }
  if (json.errors?.length) throw new Error(`GitHub API error: ${json.errors[0].message}`)
  const weeks = json.data?.user?.contributionsCollection.contributionCalendar.weeks
  if (!weeks) throw new Error(`GitHub user not found: ${login}`)

  const cells: Cell[] = []
  weeks.forEach((week, w) => {
    for (const day of week.contributionDays) {
      cells.push({
        week: w,
        day: day.weekday,
        date: day.date,
        count: day.contributionCount,
        level: LEVELS[day.contributionLevel] ?? 0,
      })
    }
  })
  return { weeks: weeks.length, cells }
}

export async function fetchGridPublic(login: string): Promise<Grid> {
  const res = await fetchWithRetry(`https://github.com/users/${login}/contributions`, {
    headers: { 'user-agent': 'koi-almanac' },
  })
  if (!res.ok) throw new Error(`GitHub responded ${res.status} for ${login}'s contribution page`)
  const html = await res.text()

  const days = parsePublicContributionDays(html)
  if (days.length === 0) throw new Error(`No contribution cells found for ${login} (user missing or GitHub markup changed)`)
  return gridFromDays(days)
}
