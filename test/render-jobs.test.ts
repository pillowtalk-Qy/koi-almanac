import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText } from '../src/environment'
import { runRenderJob } from '../src/web/render-jobs'

describe('browser render jobs', () => {
  it('renders fixed themes and reuses a committed plan for environment previews', () => {
    const grid = demoGrid('render-worker')
    const fixed = runRenderJob({ kind: 'fixed', grid, user: 'render-worker' })
    expect(fixed.kind).toBe('fixed')
    if (fixed.kind !== 'fixed') throw new Error('Expected a fixed render')
    expect(fixed.light).toContain('<svg ')
    expect(fixed.dark).toContain('<svg ')

    const environment = deriveEnvironment(momentFromText('2026-08-16', '23:00'), 'summer')
    const automatic = runRenderJob({ kind: 'auto', grid, user: 'render-worker', environment, plan: fixed.plan })
    expect(automatic.kind).toBe('auto')
    if (automatic.kind !== 'auto') throw new Error('Expected an automatic render')
    expect(automatic.plan).toEqual(fixed.plan)
    expect(automatic.svg).toContain('data-seasonal-part="summer-fireflies"')
  })
})
