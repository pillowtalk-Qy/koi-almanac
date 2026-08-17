import { readFileSync } from 'node:fs'
import { parsePondGenerator, verifyPondState } from './state'

const args = process.argv.slice(2)
const expectedArgument = args.find(argument => argument.startsWith('--expect-generator='))
const [currentPath, previousPath] = args.filter(argument => !argument.startsWith('--'))
if (!currentPath) {
  console.error(
    'Usage: npm run verify:state -- <pond-state.json> [previous-pond-state.json] ' +
      '[--expect-generator=owner/repository@commit-sha]',
  )
  process.exit(1)
}

let expectedGenerator = null
if (expectedArgument) {
  const value = expectedArgument.slice('--expect-generator='.length)
  const separator = value.lastIndexOf('@')
  expectedGenerator = parsePondGenerator({ repository: value.slice(0, separator), sha: value.slice(separator + 1) })
  if (!expectedGenerator) {
    console.error('INVALID expected generator; use owner/repository@40-character-commit-sha')
    process.exit(1)
  }
}

function readState(path: string) {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return verifyPondState(value)
  } catch {
    return null
  }
}

const current = readState(currentPath)
if (!current) {
  console.error(`INVALID ${currentPath}`)
  process.exit(2)
}

if (
  expectedGenerator &&
  (current.generator?.repository !== expectedGenerator.repository || current.generator.sha !== expectedGenerator.sha)
) {
  console.error(
    `INVALID generator: expected ${expectedGenerator.repository}@${expectedGenerator.sha}, ` +
      `found ${current.generator ? `${current.generator.repository}@${current.generator.sha}` : 'unrecorded'}`,
  )
  process.exit(4)
}

if (previousPath) {
  const previous = readState(previousPath)
  if (!previous) {
    console.error(`INVALID ${previousPath}`)
    process.exit(2)
  }
  if (current.proof.previousDigest !== previous.proof.digest || current.revision !== previous.revision + 1) {
    console.error('INVALID chain link')
    process.exit(3)
  }
  console.log(`LINKED  revision ${previous.revision} -> ${current.revision}`)
}

console.log(`VALID   ${current.owner} pond revision ${current.revision}`)
console.log(`state   ${current.proof.digest}`)
console.log(`source  ${current.proof.sourceDigest}`)
console.log(`previous ${current.proof.previousDigest ?? 'genesis'}`)
console.log(`generator ${current.generator ? `${current.generator.repository}@${current.generator.sha}` : 'unrecorded'}`)
if (current.generator) console.log(`source-code https://github.com/${current.generator.repository}/tree/${current.generator.sha}`)
