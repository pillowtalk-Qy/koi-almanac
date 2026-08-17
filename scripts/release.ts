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
const mode = process.argv.includes('--sync') ? 'sync' : 'check'
const setArgument = process.argv.find(argument => argument.startsWith('--set='))?.slice('--set='.length)
const profileArgument = process.argv.find(argument => argument.startsWith('--profile='))?.slice('--profile='.length)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReleaseManifest
if (setArgument) manifest.action.sha = setArgument
if (manifest.schemaVersion !== 1) throw new Error(`Unsupported release manifest schema ${manifest.schemaVersion}`)
if (!SHA.test(manifest.action.sha)) throw new Error('release.json action.sha must be a lowercase 40-character commit SHA')
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.action.repository)) {
  throw new Error('release.json action.repository must be an owner/repository pair')
}

const ancestry = spawnSync('git', ['merge-base', '--is-ancestor', manifest.action.sha, 'HEAD'], { cwd: root })
if (ancestry.status !== 0) throw new Error(`Release SHA ${manifest.action.sha} is not an ancestor of HEAD`)
if (setArgument && mode !== 'sync') throw new Error('--set requires --sync')
if (setArgument) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

function trackedFiles(repositoryRoot: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repositoryRoot })
    .toString()
    .split('\0')
    .filter(Boolean)
}

function synchronize(repositoryRoot: string, requireReference: boolean): number {
  const escapedRepository = manifest.action.repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escapedRepository}@([^\\s"'\\x60)<]+)`, 'g')
  let references = 0
  const failures: string[] = []

  for (const relativePath of trackedFiles(repositoryRoot)) {
    const path = resolve(repositoryRoot, relativePath)
    const contents = readFileSync(path)
    if (contents.includes(0)) continue
    const text = contents.toString('utf8')
    const matches = [...text.matchAll(pattern)]
    if (matches.length === 0) continue
    references += matches.length
    if (mode === 'sync') {
      const updated = text.replace(pattern, `${manifest.action.repository}@${manifest.action.sha}`)
      if (updated !== text) writeFileSync(path, updated)
    } else {
      for (const match of matches) {
        if (match[1] !== manifest.action.sha) failures.push(`${relativePath}: ${match[1]}`)
      }
    }
  }

  if (requireReference && references === 0) failures.push('no Action references found')
  if (failures.length > 0) {
    throw new Error(`Release references do not match ${manifest.action.sha}:\n${failures.join('\n')}`)
  }
  return references
}

const coreReferences = synchronize(root, true)
const profileReferences = profileArgument ? synchronize(resolve(profileArgument), true) : 0

if (mode === 'sync') {
  synchronize(root, true)
  if (profileArgument) synchronize(resolve(profileArgument), true)
}

console.log(
  `${mode === 'sync' ? 'Synchronized' : 'Verified'} ${coreReferences + profileReferences} Action reference(s) at ${manifest.action.sha}`,
)
