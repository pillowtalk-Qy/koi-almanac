import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ReleaseManifest {
  schemaVersion: number
  action: {
    repository: string
    sha: string
  }
}

const SHA = /^[0-9a-f]{40}$/
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(root, 'release.json')
const targetArgument = process.argv.find(argument => argument.startsWith('--to='))?.slice('--to='.length)

function parseManifest(text: string, source: string): ReleaseManifest {
  const value = JSON.parse(text) as ReleaseManifest
  if (
    value.schemaVersion !== 1 ||
    value.action?.repository !== 'pillowtalk-Qy/koi-almanac' ||
    !SHA.test(value.action?.sha ?? '')
  ) throw new Error(`Invalid release manifest in ${source}`)
  return value
}

const dirty = spawnSync('git', ['diff', '--quiet', '--', 'release.json'], { cwd: root })
if (dirty.status !== 0) throw new Error('release.json already has uncommitted changes; refusing to overwrite it')

const current = parseManifest(readFileSync(manifestPath, 'utf8'), 'working tree')
let target = targetArgument
if (target && !SHA.test(target)) throw new Error('--to must be a lowercase 40-character commit SHA')

if (!target) {
  const commits = execFileSync('git', ['log', '--format=%H', '--', 'release.json'], { cwd: root })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
  for (const commit of commits) {
    const historical = parseManifest(
      execFileSync('git', ['show', `${commit}:release.json`], { cwd: root }).toString(),
      commit,
    )
    if (historical.action.sha !== current.action.sha) {
      target = historical.action.sha
      break
    }
  }
}

if (!target) throw new Error('No previous release exists in release.json history')
if (target === current.action.sha) throw new Error('Rollback target is already published')
const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', target, 'HEAD'], { cwd: root })
if (ancestry.status !== 0) throw new Error(`Rollback target ${target} is not an ancestor of HEAD`)

const next: ReleaseManifest = { ...current, action: { ...current.action, sha: target } }
writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
console.log(`Prepared rollback ${current.action.sha} -> ${target}`)
console.log('Review release.json, then commit and push it; Profile workflows will follow it automatically.')
