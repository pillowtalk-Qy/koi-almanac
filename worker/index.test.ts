import { env, exports } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

declare module 'cloudflare:workers' {
  interface ProvidedEnv extends Env {}
}

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./index')
    }
  }
}

function calendarHTML(date: string, level: number, label: string): string {
  const id = `contribution-day-component-${date}`
  return `<!doctype html><table><tbody><tr><td id="${id}" data-date="${date}" data-level="${level}" class="ContributionCalendar-day"></td><tool-tip for="${id}">${label}</tool-tip></tr></tbody></table>`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('privacy-preserving contribution worker', () => {
  it('serves an explicit no-logging health response with restricted CORS', async () => {
    const response = await exports.default.fetch(new Request('https://api.example/health', {
      headers: { Origin: 'https://pillowtalk-qy.github.io' },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://pillowtalk-qy.github.io')
    await expect(response.json()).resolves.toEqual({
      ok: true,
      source: 'github.com',
      logging: 'disabled',
      snapshot: 'global-kv',
    })
  })

  it('rejects invalid usernames before making an upstream request', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch')
    const response = await exports.default.fetch('https://api.example/v1/contributions/not_valid')
    expect(response.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('reads contribution counts directly from GitHub and sorts the calendar', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(new Request(input).url)
      expect(url.hostname).toBe('github.com')
      const previousYear = url.searchParams.get('from')?.startsWith('2025')
      const html = previousYear
        ? `${calendarHTML('2025-01-01', 1, '1 contribution on January 1st.')}${calendarHTML('2025-12-31', 4, '1,204 contributions on December 31st.')}`
        : `${calendarHTML('2026-01-01', 0, 'No contributions on January 1st.')}${calendarHTML('2026-12-31', 2, '3 contributions on December 31st.')}`
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    })

    const response = await exports.default.fetch('https://api.example/v1/contributions/Example-User')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Koipond-Cache')).toBe('MISS')
    expect(response.headers.get('X-Koipond-Fetched-At')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const body = await response.json<{
      contributions: { date: string; count: number; level: number }[]
      source: string
      fetchedAt: string
    }>()
    expect(body.source).toBe('github.com/public-contribution-calendar')
    expect(body.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(body.contributions).toEqual([
      { date: '2025-12-31', count: 1204, level: 4 },
      { date: '2026-01-01', count: 0, level: 0 },
    ])
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('retries transient GitHub failures before returning a fresh calendar', async () => {
    const attempts = new Map<string, number>()
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(new Request(input).url)
      const key = url.href
      const attempt = (attempts.get(key) ?? 0) + 1
      attempts.set(key, attempt)
      if (attempt === 1) return new Response('temporarily unavailable', { status: 503 })
      const previousYear = url.searchParams.get('from')?.startsWith('2025')
      const html = previousYear
        ? calendarHTML('2025-12-31', 3, '8 contributions on December 31st.')
        : calendarHTML('2026-01-01', 1, '1 contribution on January 1st.')
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    })

    const response = await exports.default.fetch('https://retry.example/v1/contributions/Retry-User')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Koipond-Cache')).toBe('MISS')
    expect(upstream).toHaveBeenCalledTimes(4)
    expect([...attempts.values()]).toEqual([2, 2])
  })

  it('serves the last successful snapshot when GitHub remains unavailable', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(new Request(input).url)
      const previousYear = url.searchParams.get('from')?.startsWith('2025')
      const html = previousYear
        ? calendarHTML('2025-12-31', 2, '4 contributions on December 31st.')
        : calendarHTML('2026-01-01', 0, 'No contributions on January 1st.')
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    })
    const url = 'https://stale.example/v1/contributions/Stale-User'
    const first = await exports.default.fetch(url)
    expect(first.headers.get('X-Koipond-Cache')).toBe('MISS')

    const cache = await caches.open('koi-almanac-contributions-v2')
    const freshKey = new Request('https://stale.example/v1/contributions/stale-user')
    const staleKey = new Request('https://stale.example/__cache/stale/v1/contributions/stale-user')
    await vi.waitFor(async () => {
      expect(await cache.match(staleKey)).toBeDefined()
    })
    await cache.delete(freshKey)
    upstream.mockResolvedValue(new Response('temporarily unavailable', { status: 503 }))

    const response = await exports.default.fetch(new Request(url, {
      headers: { Origin: 'https://pillowtalk-qy.github.io' },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Koipond-Cache')).toBe('STALE')
    expect(response.headers.get('X-Koipond-Degraded')).toBe('upstream')
    expect(response.headers.get('X-Koipond-Snapshot')).toBe('edge')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Koipond-Cache')
    const body = await response.json<{
      contributions: { date: string; count: number; level: number }[]
      fetchedAt: string
    }>()
    expect(body.contributions).toHaveLength(2)
    expect(body.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('serves the globally shared snapshot after local edge caches are lost', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(new Request(input).url)
      const previousYear = url.searchParams.get('from')?.startsWith('2025')
      const html = previousYear
        ? calendarHTML('2025-12-31', 4, '12 contributions on December 31st.')
        : calendarHTML('2026-01-01', 1, '1 contribution on January 1st.')
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    })
    const url = 'https://global.example/v1/contributions/Global-User'
    const first = await exports.default.fetch(url)
    expect(first.headers.get('X-Koipond-Cache')).toBe('MISS')

    const snapshot = 'contributions:v1:global-user'
    await vi.waitFor(async () => {
      expect(await env.CONTRIBUTION_SNAPSHOTS.get(snapshot)).not.toBeNull()
    })
    const cache = await caches.open('koi-almanac-contributions-v2')
    await Promise.all([
      cache.delete(new Request('https://global.example/v1/contributions/global-user')),
      cache.delete(new Request('https://global.example/__cache/stale/v1/contributions/global-user')),
    ])
    upstream.mockResolvedValue(new Response('temporarily unavailable', { status: 503 }))

    const response = await exports.default.fetch(new Request(url, {
      headers: { Origin: 'https://pillowtalk-qy.github.io' },
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Koipond-Cache')).toBe('STALE')
    expect(response.headers.get('X-Koipond-Snapshot')).toBe('global')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Koipond-Snapshot')
    await expect(response.json()).resolves.toMatchObject({
      source: 'github.com/public-contribution-calendar',
      contributions: [
        { date: '2025-12-31', count: 12, level: 4 },
        { date: '2026-01-01', count: 1, level: 1 },
      ],
    })
    await env.CONTRIBUTION_SNAPSHOTS.delete(snapshot)
  })

  it('does not grant CORS access to unrelated sites', async () => {
    const response = await exports.default.fetch(new Request('https://api.example/health', {
      headers: { Origin: 'https://tracking.example' },
    }))
    expect(response.status).toBe(403)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })
})
