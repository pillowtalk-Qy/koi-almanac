import type { PondEnvironment } from '../environment'
import { plan } from '../planner'
import { THEMES, themeForEnvironment } from '../render/palette'
import { renderSVG } from '../render/svg'
import type { Grid, Plan } from '../types'

export interface FixedRenderJob {
  kind: 'fixed'
  grid: Grid
  user: string
}

export interface AutoRenderJob {
  kind: 'auto'
  grid: Grid
  user: string
  environment: PondEnvironment
  plan?: Plan
}

export type RenderJob = FixedRenderJob | AutoRenderJob

export interface FixedRenderResult {
  kind: 'fixed'
  plan: Plan
  light: string
  dark: string
}

export interface AutoRenderResult {
  kind: 'auto'
  plan: Plan
  svg: string
}

export type RenderJobResult = FixedRenderResult | AutoRenderResult

export interface RenderWorkerRequest {
  revision: number
  job: RenderJob
}

export type RenderWorkerResponse =
  | { revision: number; result: RenderJobResult }
  | { revision: number; error: string }

export function runRenderJob(job: RenderJob): RenderJobResult {
  if (job.kind === 'fixed') {
    const pondPlan = plan(job.grid, job.user)
    return {
      kind: 'fixed',
      plan: pondPlan,
      light: renderSVG(job.grid, pondPlan, THEMES.light, job.user).svg,
      dark: renderSVG(job.grid, pondPlan, THEMES.dark, job.user).svg,
    }
  }

  const pondPlan = job.plan ?? plan(job.grid, job.user, undefined, job.environment)
  return {
    kind: 'auto',
    plan: pondPlan,
    svg: renderSVG(
      job.grid,
      pondPlan,
      themeForEnvironment(job.environment),
      job.user,
      { environment: job.environment },
    ).svg,
  }
}
