import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROFILE_WORKFLOW } from '../src/profile-workflow'
import { validateProfileWorkflow } from '../src/synthetic-monitor'

describe('Profile workflow', () => {
  it('keeps the README and one-click installer on the canonical release resolver', () => {
    validateProfileWorkflow(PROFILE_WORKFLOW)
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
    const usage = readme.split('## Usage (GitHub Action)')[1]?.split('## Quick start')[0]
    const documented = usage?.match(/```yaml\n([\s\S]*?)```/)?.[1]
    expect(documented).toBe(PROFILE_WORKFLOW)
  })

  it('executes only a validated full commit SHA', () => {
    expect(PROFILE_WORKFLOW).toContain('/^[0-9a-f]{40}$/')
    expect(PROFILE_WORKFLOW).toContain('ref: ${{ steps.release.outputs.sha }}')
    expect(PROFILE_WORKFLOW).not.toMatch(/uses:\s*pillowtalk-Qy\/koi-almanac@/)
  })
})
