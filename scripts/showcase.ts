import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renderReadmeShowcase, SHOWCASE_LOOP_SECONDS, showcaseScenes } from '../src/showcase'

const outputArgument = process.argv.find(argument => argument.startsWith('--out='))?.slice('--out='.length)
const output = resolve(outputArgument || 'assets/demo-cycle.svg')
const svg = renderReadmeShowcase()

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, svg)
console.log(
  `${output}  ${(Buffer.byteLength(svg) / 1024 / 1024).toFixed(2)} MB | ` +
  `${showcaseScenes().length} living scenes | ${SHOWCASE_LOOP_SECONDS}s loop`,
)
