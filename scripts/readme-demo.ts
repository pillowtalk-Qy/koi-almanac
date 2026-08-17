import { writeFileSync } from 'node:fs'
import { renderReadmeDemo, README_DEMO_LOOP_SECONDS, readmeDemoScenes } from '../src/readme-demo'

const output = 'assets/demo-almanac.svg'
const svg = renderReadmeDemo()
writeFileSync(output, svg)
console.log(
  `${output}  ${(Buffer.byteLength(svg) / 1_000_000).toFixed(2)} MB | ` +
  `${readmeDemoScenes().length} native scenes | ${README_DEMO_LOOP_SECONDS}s environmental loop`,
)
