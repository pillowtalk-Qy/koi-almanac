import { LAYOUT } from './layout'
import { rng } from './prng'
import type { PondEnvironment } from './environment'
import type { Cell, Grid } from './types'

const ENERGY_BY_LEVEL = [0, 1, 2, 4, 7] as const

export interface EcosystemStats {
  activeDays: number
  totalEnergy: number
  energyDensity: number
  consistency: number
  burstiness: number
  recentEnergy: number
}

export interface LilyPadSpec {
  x: number
  y: number
  radius: number
  notchDeg: number
  duration: number
}

export interface IceFloeSpec {
  x: number
  y: number
  rx: number
  ry: number
  rotation: number
}

export interface PondPoint {
  x: number
  y: number
}

export interface IceFloeContactSpec extends PondPoint {
  normalX: number
  normalY: number
}

export interface PondObstacleSpec {
  x: number
  y: number
  radius: number
  kind: 'lily' | 'ice'
}

export function cellEnergy(cell: Pick<Cell, 'level'>): number {
  return ENERGY_BY_LEVEL[cell.level]
}

export function ecosystemStats(grid: Grid): EcosystemStats {
  const active = grid.cells.filter(cell => cell.level > 0)
  const energies = active.map(cellEnergy)
  const totalEnergy = energies.reduce((sum, energy) => sum + energy, 0)
  const energyDensity = active.length === 0 ? 0 : totalEnergy / active.length
  const consistency = grid.cells.length === 0 ? 0 : active.length / grid.cells.length

  const mean = energyDensity
  const variance =
    energies.length === 0 ? 0 : energies.reduce((sum, energy) => sum + (energy - mean) ** 2, 0) / energies.length
  const burstiness = mean === 0 ? 0 : Math.min(1, Math.sqrt(variance) / mean)

  const recent = [...grid.cells]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30)
    .reduce((sum, cell) => sum + cellEnergy(cell), 0)

  return {
    activeDays: active.length,
    totalEnergy,
    energyDensity,
    consistency,
    burstiness,
    recentEnergy: Math.min(1, recent / (30 * ENERGY_BY_LEVEL[4])),
  }
}

export function desiredPopulation(stats: EcosystemStats): number {
  const carryingCapacity = stats.activeDays + stats.totalEnergy * 0.18 + stats.recentEnergy * 42
  return Math.max(1, Math.min(4, 1 + Math.floor(carryingCapacity / 130)))
}

export function lilyPadLayout(width: number, seed: string): LilyPadSpec[] {
  const r = rng(`lilies:${seed}`)
  const positions: [number, number, number][] = [
    [46 + r() * 14, 22 + r() * 8, 12 + r() * 3],
    [78 + r() * 10, 40 + r() * 8, 8 + r() * 2.5],
    [width - 58 - r() * 12, LAYOUT.height - 32 - r() * 8, 13 + r() * 3],
    [width - 96 - r() * 10, LAYOUT.height - 52, 7.5 + r() * 2],
  ]

  return positions.map(([x, y, radius], index) => ({
    x,
    y,
    radius,
    notchDeg: r() * 360,
    duration: 5.5 + index * 0.9 + r() * 2,
  }))
}

export function iceFloeLayout(width: number, seed: string, coverage = 1): IceFloeSpec[] {
  if (coverage < 0.18) return []
  const r = rng(`ice:${seed}`)
  const visibleCoverage = Math.min(1, (coverage - 0.18) / 0.82)
  const scale = 0.58 + visibleCoverage * 0.42
  const specs: Array<[number, number, number, number, number]> = [
    [width * 0.27, 58, 50, 21, -8],
    [width * 0.58, LAYOUT.height - 50, 64, 22, 4],
    [width * 0.81, 76, 40, 18, -11],
  ]
  return specs.map(([x, y, rx, ry, rotation]) => ({
    x: x + (r() - 0.5) * 12,
    y: y + (r() - 0.5) * 8,
    rx: rx * scale,
    ry: ry * scale,
    rotation: rotation + (r() - 0.5) * 5,
  }))
}

export function iceFloeBoundaryPoints(floe: IceFloeSpec, seed: string, index: number): PondPoint[] {
  const r = rng(`ice-shape:${seed}:${index}`)
  return Array.from({ length: 12 }, (_, point) => {
    const angle = (point / 12) * Math.PI * 2
    const variance = 0.88 + r() * 0.2
    return {
      x: Math.cos(angle) * floe.rx * variance,
      y: Math.sin(angle) * floe.ry * variance,
    }
  })
}

export function iceFloeWorldBoundaryPoints(floe: IceFloeSpec, seed: string, index: number): PondPoint[] {
  const angle = (floe.rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return iceFloeBoundaryPoints(floe, seed, index).map(point => ({
    x: floe.x + point.x * cos - point.y * sin,
    y: floe.y + point.x * sin + point.y * cos,
  }))
}

export function iceFloeSideContact(
  floe: IceFloeSpec,
  seed: string,
  index: number,
  side: 'left' | 'right',
): IceFloeContactSpec {
  const points = iceFloeWorldBoundaryPoints(floe, seed, index)
  const contactIndex = points.reduce((best, point, pointIndex) => {
    const isBetter = side === 'left' ? point.x < points[best].x : point.x > points[best].x
    return isBetter ? pointIndex : best
  }, 0)
  const point = points[contactIndex]
  const previous = points[(contactIndex - 1 + points.length) % points.length]
  const next = points[(contactIndex + 1) % points.length]
  const tangentX = next.x - previous.x
  const tangentY = next.y - previous.y
  const tangentLength = Math.hypot(tangentX, tangentY) || 1
  let normalX = tangentY / tangentLength
  let normalY = -tangentX / tangentLength
  if ((point.x - floe.x) * normalX + (point.y - floe.y) * normalY < 0) {
    normalX *= -1
    normalY *= -1
  }
  return { x: point.x, y: point.y, normalX, normalY }
}

export function pondObstacleLayout(
  width: number,
  seed: string,
  environment?: PondEnvironment,
): PondObstacleSpec[] {
  const coverage = environment?.plantCoverage ?? 1
  const visiblePads = coverage * lilyPadLayout(width, seed).length
  const lilies = lilyPadLayout(width, seed)
    .map((pad, index) => ({ pad, opacity: Math.max(0, Math.min(1, visiblePads - index)) }))
    .filter(({ opacity }) => opacity > 0.12)
    .map(({ pad, opacity }) => ({
      x: pad.x,
      y: pad.y,
      radius: pad.radius * Math.sqrt(opacity),
      kind: 'lily' as const,
    }))

  const ice = iceFloeLayout(width, seed, environment?.iceCoverage ?? 0).flatMap((floe, index) => {
    const angle = (floe.rotation * Math.PI) / 180
    const core = [-0.55, 0, 0.55].map(offset => ({
      x: floe.x + Math.cos(angle) * floe.rx * offset,
      y: floe.y + Math.sin(angle) * floe.rx * offset,
      radius: floe.ry * 0.72,
      kind: 'ice' as const,
    }))
    const edge = iceFloeWorldBoundaryPoints(floe, seed, index).map(point => ({
      ...point,
      radius: 2.5,
      kind: 'ice' as const,
    }))
    return [...core, ...edge]
  })
  return [...lilies, ...ice]
}
