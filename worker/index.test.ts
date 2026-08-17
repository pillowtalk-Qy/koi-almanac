import { exports } from 'cloudflare:workers'
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
    await expect(response.json()).resolves.toEqual({ ok: true, source: 'github.com', logging: 'disabled' })
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
    const body = await response.json<{
      contributions: { date: string; count: number; level: number }[]
      source: string
    }>()
    expect(body.source).toBe('github.com/public-contribution-calendar')
    expect(body.contributions).toEqual([
      { date: '2025-12-31', count: 1204, level: 4 },
      { date: '2026-01-01', count: 0, level: 0 },
    ])
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('does not grant CORS access to unrelated sites', async () => {
    const response = await exports.default.fetch(new Request('https://api.example/health', {
      headers: { Origin: 'https://tracking.example' },
    }))
    expect(response.status).toBe(403)
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })
})
