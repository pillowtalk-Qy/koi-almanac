import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText, type PondSeason } from '../src/environment'
import { auditMotion, motionAuditFailures } from '../src/motion-audit'
import { plan } from '../src/planner'
import { themeForEnvironment } from '../src/render/palette'
import { renderSVG } from '../src/render/svg'
import { renderVideo } from '../src/video'

const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = outputArgument?.slice('--out='.length) || '.motion-regression'
const metricsOnly = process.argv.includes('--metrics-only')
const grid = demoGrid('motion-regression')
const moments: Array<{ date: string; season: PondSeason }> = [
  { date: '2026-04-16', season: 'spring' },
  { date: '2026-08-16', season: 'summer' },
  { date: '2026-10-16', season: 'autumn' },
  { date: '2026-01-15', season: 'winter' },
]
const report: Record<string, ReturnType<typeof auditMotion>> = {}
const failures: string[] = []

mkdirSync(outputDirectory, { recursive: true })
for (const moment of moments) {
  for (const time of ['12:00', '00:00']) {
    const phase = time === '12:00' ? 'day' : 'night'
    const name = `${moment.season}-${phase}`
    const environment = deriveEnvironment(momentFromText(moment.date, time), moment.season)
    const pond = plan(grid, 'motion-regression', undefined, environment)
    const rendered = renderSVG(grid, pond, themeForEnvironment(environment), 'motion-regression', { environment })
    const svgFile = join(outputDirectory, `${name}.svg`)
    writeFileSync(svgFile, rendered.svg)
    report[name] = auditMotion(pond)
    failures.push(...motionAuditFailures(report[name]).map(failure => `${name}: ${failure}`))
    if (!metricsOnly) {
      await renderVideo(rendered.svg, join(outputDirectory, `${name}-seam.mp4`), rendered.meta.duration, {
        fps: 15,
        start: rendered.meta.duration - 1.5,
        duration: 3,
        scale: 1,
      })
    }
  }
}

writeFileSync(join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
if (failures.length > 0) throw new Error(`Motion regression failed:\n${failures.join('\n')}`)
console.log(`${outputDirectory}/report.json  ${Object.keys(report).length} seasonal day/night scenarios verified`)
