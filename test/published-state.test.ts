import { describe, expect, it } from 'vitest'
import { fetchPublishedPondState, publishedStateURL } from '../src/published-state'

describe('published pond state', () => {
  it('builds an encoded GitHub Contents API URL', () => {
    expect(publishedStateURL('pillowtalk-Qy/pillowtalk-Qy', 'output pond', 'state/pond state.json')).toBe(
      'https://api.github.com/repos/pillowtalk-Qy/pillowtalk-Qy/contents/state/pond%20state.json?ref=output%20pond',
    )
  })

  it('decodes a base64 state response and authenticates the request', async () => {
    const value = { version: 2, proof: { digest: 'abc' } }
    let authorization = ''
    const request = async (_input: string | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization') ?? ''
      return new Response(
        JSON.stringify({ encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64') }),
        { status: 200 },
      )
    }

    await expect(fetchPublishedPondState('a/b', 'output', 'pond-state.json', 'token', request)).resolves.toEqual(value)
    expect(authorization).toBe('bearer token')
  })

  it('treats a missing first state as genesis and rejects path traversal', async () => {
    const missing = async () => new Response('', { status: 404 })
    await expect(fetchPublishedPondState('a/b', 'output', 'pond-state.json', 'token', missing)).resolves.toBeNull()
    expect(() => publishedStateURL('a/b', 'output', '../pond-state.json')).toThrow('Invalid published state path')
  })
})
