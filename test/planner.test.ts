import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import {
  cellEnergy,
  desiredPopulation,
  ecosystemStats,
  iceFloeBoundaryPoints,
  iceFloeLayout,
  iceFloeSideContact,
  lilyPadLayout,
  pondObstacleLayout,
} from '../src/ecology'
import { deriveEnvironment, momentFromText } from '../src/environment'
import { svgWidth } from '../src/layout'
import { ACTIVE_FRACTION, longestGap, longestStreak, plan } from '../src/planner'
import { fishStaticTrail } from '../src/render/fish'
import { THEMES } from '../src/render/palette'
import { renderSVG } from '../src/render/svg'
import { finalizePondState, highlightedCells, preparePondState, provenanceFor } from '../src/state'

const grid = demoGrid('test-user')

describe('planner', () => {
  it('is deterministic for the same seed', () => {
    expect(JSON.stringify(plan(grid, 'x'))).toBe(JSON.stringify(plan(grid, 'x')))
  })

  it('differs across seeds', () => {
    expect(JSON.stringify(plan(grid, 'a'))).not.toBe(JSON.stringify(plan(grid, 'b')))
  })

  it('replans winter routes around the shared ice geometry', () => {
    const winter = deriveEnvironment(momentFromText('2026-01-15', '12:00'), 'winter')
    const regular = plan(grid, 'x')
    const frozen = plan(grid, 'x', undefined, winter)
    const ice = pondObstacleLayout(svgWidth(grid.weeks), 'x', winter).filter(obstacle => obstacle.kind === 'ice')
    expect(frozen).not.toEqual(regular)
    expect(ice).toHaveLength(45)
    expect(frozen.eats).toHaveLength(grid.cells.filter(cell => cell.level > 0).length)
    let minimumClearance = Infinity
    for (const fish of frozen.fishes) {
      for (const waypoint of fish.waypoints) {
        for (const obstacle of ice) {
          minimumClearance = Math.min(
            minimumClearance,
            Math.hypot(waypoint.x - obstacle.x, waypoint.y - obstacle.y) - obstacle.radius,
          )
        }
      }
    }
    expect(minimumClearance).toBeGreaterThan(0)
  })

  it('eats every plankton exactly once', () => {
    const p = plan(grid, 'x')
    const active = grid.cells.filter(c => c.level > 0)
    expect(p.eats.length).toBe(active.length)
    expect(new Set(p.eats.map(e => e.cell)).size).toBe(active.length)
  })

  it('finishes feeding inside the active window', () => {
    const p = plan(grid, 'x')
    for (const e of p.eats) {
      expect(e.t).toBeGreaterThan(0)
      expect(e.t).toBeLessThanOrEqual(p.duration * ACTIVE_FRACTION + 1e-9)
    }
  })

  it('gives every fish monotonic waypoints that end at home', () => {
    const p = plan(grid, 'x')
    for (const f of p.fishes) {
      for (let i = 1; i < f.waypoints.length; i++) {
        expect(f.waypoints[i].t).toBeGreaterThan(f.waypoints[i - 1].t)
      }
      const last = f.waypoints[f.waypoints.length - 1]
      expect(last.x).toBeCloseTo(f.start.x, 5)
      expect(last.y).toBeCloseTo(f.start.y, 5)
      expect(last.satiety).toBe(0)
      expect(f.waypoints.every(wp => wp.satiety >= 0 && wp.satiety <= 1)).toBe(true)
    }
  })

  it('returns every fish within its swimming envelope and preserves body length across the loop seam', () => {
    const environments = [
      deriveEnvironment(momentFromText('2026-08-16', '12:00')),
      deriveEnvironment(momentFromText('2026-08-16', '00:00')),
      deriveEnvironment(momentFromText('2026-01-15', '00:00'), 'winter'),
    ]

    const scenarios = [
      ...environments.map(environment => ({ environment, grid, seed: 'loop-seam' })),
      {
        environment: environments[2],
        grid: {
          ...grid,
          cells: grid.cells.map(cell => ({ ...cell, count: Math.max(6, cell.count), level: 4 as const })),
        },
        seed: 'stress-2',
      },
    ]

    for (const scenario of scenarios) {
      const pond = plan(scenario.grid, scenario.seed, undefined, scenario.environment)
      for (const fish of pond.fishes) {
        const speedLimit = fish.species === 'koi' ? 60 : 82
        for (let index = 1; index < fish.waypoints.length; index++) {
          const previous = fish.waypoints[index - 1]
          const waypoint = fish.waypoints[index]
          const speed = Math.hypot(waypoint.x - previous.x, waypoint.y - previous.y) /
            (waypoint.t - previous.t)
          expect(speed).toBeLessThanOrEqual(speedLimit)
        }

        const seamTrails = [pond.duration - 0.02, 0.02].map(time => {
          const trail = fishStaticTrail(fish, time, pond.duration)
          for (let index = 1; index < trail.length; index++) {
            expect(Math.hypot(trail[index].x - trail[index - 1].x, trail[index].y - trail[index - 1].y))
              .toBeLessThan(5)
          }
          return trail
        })
        const bodyLength = (trail: ReturnType<typeof fishStaticTrail>) =>
          Math.hypot(trail[0].x - trail.at(-1)!.x, trail[0].y - trail.at(-1)!.y)
        expect(bodyLength(seamTrails[0])).toBeGreaterThan(15)
        expect(Math.abs(bodyLength(seamTrails[0]) - bodyLength(seamTrails[1]))).toBeLessThan(1.5)
      }
    }
  })

  it('conserves contribution energy across fish and feeding events', () => {
    const p = plan(grid, 'x')
    const expected = grid.cells.reduce((sum, cell) => sum + cellEnergy(cell), 0)
    expect(p.eats.reduce((sum, event) => sum + event.energy, 0)).toBe(expected)
    expect(p.fishes.reduce((sum, fish) => sum + fish.energy, 0)).toBe(expected)
    expect(p.fishes.some(fish => fish.waypoints.some(wp => wp.satiety > 0))).toBe(true)
  })

  it('handles an empty year without eats', () => {
    const empty = { weeks: 53, cells: grid.cells.map(c => ({ ...c, count: 0, level: 0 as const })) }
    const p = plan(empty, 'x')
    expect(p.eats.length).toBe(0)
    expect(p.fishes.length).toBeGreaterThan(0)
    expect(p.duration).toBeGreaterThanOrEqual(24)
  })
})

describe('achievements', () => {
  it('detects the demo streak and gap', () => {
    expect(longestStreak(grid)).toBeGreaterThanOrEqual(30)
    expect(longestGap(grid).len).toBeGreaterThanOrEqual(21)
  })
})

describe('ecology', () => {
  it('shares deterministic irregular ice edges and outward contact normals', () => {
    const floe = iceFloeLayout(737, 'ice-contact', 1)[1]
    const points = iceFloeBoundaryPoints(floe, 'ice-contact', 1)
    const left = iceFloeSideContact(floe, 'ice-contact', 1, 'left')
    const right = iceFloeSideContact(floe, 'ice-contact', 1, 'right')

    expect(points).toHaveLength(12)
    expect(left.x).toBeLessThan(floe.x)
    expect(right.x).toBeGreaterThan(floe.x)
    expect((left.x - floe.x) * left.normalX + (left.y - floe.y) * left.normalY).toBeGreaterThan(0)
    expect((right.x - floe.x) * right.normalX + (right.y - floe.y) * right.normalY).toBeGreaterThan(0)
  })

  it('maps contribution levels to increasing energy', () => {
    const energy = ([0, 1, 2, 3, 4] as const).map(level => cellEnergy({ level }))
    expect(energy).toEqual([0, 1, 2, 4, 7])
  })

  it('derives stable activity traits and lily-pad obstacles', () => {
    const stats = ecosystemStats(grid)
    expect(stats.activeDays).toBe(grid.cells.filter(cell => cell.level > 0).length)
    expect(stats.totalEnergy).toBeGreaterThan(stats.activeDays)
    expect(stats.consistency).toBeGreaterThan(0)
    expect(stats.consistency).toBeLessThanOrEqual(1)
    expect(stats.burstiness).toBeGreaterThanOrEqual(0)
    expect(lilyPadLayout(svgWidth(grid.weeks), 'x')).toEqual(lilyPadLayout(svgWidth(grid.weeks), 'x'))
  })

  it('keeps sparse ponds intimate and caps dense ponds at four fish', () => {
    const empty = { ...grid, cells: grid.cells.map(cell => ({ ...cell, count: 0, level: 0 as const })) }
    const dense = { ...grid, cells: grid.cells.map(cell => ({ ...cell, count: 20, level: 4 as const })) }
    expect(desiredPopulation(ecosystemStats(empty))).toBe(1)
    expect(desiredPopulation(ecosystemStats(dense))).toBe(4)
  })

  it('keeps planned paths finite, bounded and outside lily pads', () => {
    const p = plan(grid, 'x')
    const pads = lilyPadLayout(svgWidth(grid.weeks), 'x')
    for (const fish of p.fishes) {
      for (const waypoint of fish.waypoints) {
        expect(Number.isFinite(waypoint.x) && Number.isFinite(waypoint.y)).toBe(true)
        expect(waypoint.x).toBeGreaterThan(0)
        expect(waypoint.x).toBeLessThan(svgWidth(grid.weeks))
        expect(waypoint.y).toBeGreaterThan(0)
        for (const pad of pads) {
          expect(Math.hypot(waypoint.x - pad.x, waypoint.y - pad.y)).toBeGreaterThan(pad.radius)
        }
      }
    }
  })

  it('handles a fully active year within the dense asset budget', () => {
    const dense = { ...grid, cells: grid.cells.map(cell => ({ ...cell, count: 20, level: 4 as const })) }
    const p = plan(dense, 'dense')
    const { meta } = renderSVG(dense, p, THEMES.dark, 'dense')
    expect(p.fishes).toHaveLength(4)
    expect(p.eats).toHaveLength(dense.cells.length)
    expect(meta.bytes).toBeLessThan(400 * 1024)
  })
})

describe('render', () => {
  it('renders one plankton group and one ripple per active cell', () => {
    const p = plan(grid, 'x')
    const active = grid.cells.filter(c => c.level > 0).length
    const light = renderSVG(grid, p, THEMES.light, 'x').svg
    const dark = renderSVG(grid, p, THEMES.dark, 'x').svg
    expect((light.match(/class="pk /g) ?? []).length).toBe(active)
    expect((dark.match(/class="pk /g) ?? []).length).toBe(active)
    expect((light.match(/class="rp /g) ?? []).length).toBe(active)
    expect(light).toContain('<svg')
    expect(light).toContain('@keyframes fp0')
    expect(light).toContain('@keyframes floor')
    expect(light).toContain('@keyframes floor{0%,100%')
    expect(light).toContain('id="floorSoft"')
    expect(light).toContain('<path class="floor"')
    expect((light.match(/class="floor"/g) ?? []).length).toBe(5)
    expect((light.match(/class="current"/g) ?? []).length).toBe(3)
  })

  it('is deterministic end to end', () => {
    const a = renderSVG(grid, plan(grid, 'x'), THEMES.light, 'x').svg
    const b = renderSVG(grid, plan(grid, 'x'), THEMES.light, 'x').svg
    expect(a).toBe(b)
  })

  it('keeps a complete accessible still frame for reduced motion', () => {
    const p = plan(grid, 'x')
    const { svg, meta } = renderSVG(grid, p, THEMES.dark, 'x')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<desc id="kp-desc-dark">')
    expect(svg).toContain('@media (prefers-reduced-motion:reduce)')
    expect(svg).toMatch(/class="f0" style="transform:translate\([\d.]+px,[\d.]+px\)/)
    expect(meta.bytes).toBeLessThan(230 * 1024)
  })

  it('embeds verifiable provenance and highlights only the latest delta', () => {
    const generator = {
      repository: 'pillowtalk-Qy/koi-almanac',
      sha: '1234567890abcdef1234567890abcdef12345678',
    }
    const prepared = preparePondState(grid, 'pillowtalk-Qy', 'x', null, generator)
    const state = finalizePondState(prepared, plan(grid, 'x', prepared.identities))
    const p = plan(grid, 'x', state.fish)
    const oneHighlight = new Set([p.eats[0].cell])
    const { svg } = renderSVG(grid, p, THEMES.dark, 'x', {
      provenance: provenanceFor(state),
      highlightedCells: oneHighlight,
    })

    expect(svg).toContain('<metadata id="koipond-provenance">')
    expect(svg).toContain(state.proof.digest)
    expect(svg).toContain(generator.repository)
    expect(svg).toContain(generator.sha)
    expect((svg.match(/class="rp r[^"]+ fresh"/g) ?? []).length).toBe(1)
    expect(highlightedCells(grid, state).size).toBe(grid.cells.filter(cell => cell.level > 0).length)
  })
})
