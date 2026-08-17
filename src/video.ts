import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

export interface VideoOptions {
  fps?: number
  start?: number
  duration?: number
  scale?: number
}

export function parseVideoQuery(query: string | undefined): VideoOptions {
  const params = new URLSearchParams(query ?? '')
  const num = (name: string) => {
    const v = params.get(name)
    return v === null ? undefined : Number(v)
  }
  return { fps: num('fps'), start: num('start'), duration: num('dur'), scale: num('scale') }
}

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

export function findBrowser(): string {
  const fromEnv = process.env.KOIPOND_BROWSER
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  for (const path of BROWSER_CANDIDATES) {
    if (existsSync(path)) return path
  }
  throw new Error('No Chromium-based browser found. Set KOIPOND_BROWSER to a Chrome or Edge executable.')
}

function assertFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  if (probe.error || probe.status !== 0) {
    throw new Error('ffmpeg not found on PATH. Install ffmpeg to generate gif or mp4 outputs.')
  }
}

export async function renderVideo(svg: string, file: string, loopSeconds: number, opts: VideoOptions = {}): Promise<void> {
  assertFfmpeg()
  const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  if (!size) throw new Error('Could not read the SVG viewBox')
  const width = Number(size[1])
  const height = Number(size[2])

  const gif = file.endsWith('.gif')
  const fps = Math.min(60, Math.max(2, opts.fps ?? (gif ? 10 : 30)))
  const start = opts.start ?? 0
  const duration = Math.max(1, opts.duration ?? loopSeconds)
  const scale = Math.min(3, Math.max(0.25, opts.scale ?? (gif ? 1 : 2)))
  const frames = Math.min(7200, Math.round(duration * fps))

  const workDir = mkdtempSync(join(tmpdir(), 'koi-almanac-frames-'))
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: scale })
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`,
      { waitUntil: 'load' },
    )
    await page.evaluate(() => document.getAnimations().forEach(a => a.pause()))
    for (let i = 0; i < frames; i++) {
      const t = ((start + i / fps) % loopSeconds) * 1000
      await page.evaluate(ms => document.getAnimations().forEach(a => (a.currentTime = ms)), t)
      await page.screenshot({ path: join(workDir, `f${String(i).padStart(4, '0')}.png`) as `${string}.png` })
    }
  } finally {
    await browser.close()
  }

  const outDir = dirname(file)
  if (outDir) mkdirSync(outDir, { recursive: true })
  const filters = gif
    ? [`fps=${fps},split[a][b];[a]palettegen[p];[b][p]paletteuse`]
    : []
  const args = ['-y', '-framerate', String(fps), '-i', join(workDir, 'f%04d.png')]
  if (gif) args.push('-vf', filters[0])
  else
    args.push(
      '-vf',
      'crop=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '16',
      '-movflags',
      '+faststart',
    )
  args.push(file)
  const result = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
  rmSync(workDir, { recursive: true, force: true })
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr?.toString().slice(-400)}`)
  }
}
