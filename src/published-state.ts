import { fetchWithRetry } from './github'

type Requester = (input: string | URL, init?: RequestInit) => Promise<Response>

export function publishedStateURL(repository: string, branch: string, path: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error('Invalid GitHub repository name')
  const segments = path.split('/')
  if (segments.length === 0 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid published state path')
  }
  const encodedPath = segments.map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
}

export async function fetchPublishedPondState(
  repository: string,
  branch: string,
  path: string,
  token: string,
  request: Requester = fetchWithRetry,
): Promise<unknown> {
  const response = await request(publishedStateURL(repository, branch, path), {
    headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'koi-almanac' },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub state API responded ${response.status}`)
  const payload = (await response.json()) as { content?: string; encoding?: string }
  if (payload.encoding !== 'base64' || !payload.content) throw new Error('GitHub state response did not contain base64 data')
  try {
    return JSON.parse(Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8'))
  } catch {
    throw new Error('Published pond state is not valid JSON')
  }
}
