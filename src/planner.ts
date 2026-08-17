import { cellEnergy, desiredPopulation, ecosystemStats, pondObstacleLayout, type PondObstacleSpec } from './ecology'
import type { PondEnvironment } from './environment'
import { rng } from './prng'
import { LAYOUT, cellCenter, svgWidth } from './layout'
import type { EatEvent, FishIdentity, FishPlan, Grid, Plan, Point } from './types'

export const ACTIVE_FRACTION = 0.92

const SIM_DT = 1 / 30
const SAMPLE_DT = 0.1

interface Target {
  cell: number
  x: number
  y: number
  level: number
  energy: number
}

interface Sim {
  f: FishPlan
  pos: { x: number; y: number }
  vel: { x: number; y: number }
  loopVelocity: { x: number; y: number }
  runwayStart: { x: number; y: number }
  target: Target | null
  targetAge: number
  wander: number
  maxSpeed: number
  maxForce: number
  satiety: number
}

function resolveIceCollision(point: { x: number; y: number }, obstacles: PondObstacleSpec[]): boolean {
  let moved = false
  for (let pass = 0; pass < 12; pass++) {
    let passMoved = false
    for (const obstacle of obstacles) {
      if (obstacle.kind !== 'ice') continue
      const ox = point.x - obstacle.x
      const oy = point.y - obstacle.y
      const distance = Math.hypot(ox, oy)
      const boundary = obstacle.radius + 0.75
      if (distance >= boundary) continue
      const nx = distance > 1e-6 ? ox / distance : 1
      const ny = distance > 1e-6 ? oy / distance : 0
      point.x = obstacle.x + nx * boundary
      point.y = obstacle.y + ny * boundary
      passMoved = true
      moved = true
    }
    if (!passMoved) break
  }
  return moved
}

function loopSetup(
  idealStart: { x: number; y: number },
  preferredAngle: number,
  runwayLength: number,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
) {
  let best = {
    start: { ...idealStart },
    direction: { x: Math.cos(preferredAngle), y: Math.sin(preferredAngle) },
    score: -Infinity,
  }
  for (let ring = 0; ring <= 4; ring++) {
    const radius = ring * 18
    const positions = ring === 0 ? 1 : 16
    for (let position = 0; position < positions; position++) {
      const homeAngle = (position * Math.PI * 2) / positions
      const start = {
        x: idealStart.x + Math.cos(homeAngle) * radius,
        y: idealStart.y + Math.sin(homeAngle) * radius,
      }
      for (let candidate = 0; candidate < 16; candidate++) {
        const angle = preferredAngle + (candidate * Math.PI) / 8
        const x = Math.cos(angle)
        const y = Math.sin(angle)
        let clearance = Infinity
        for (let sample = -8; sample <= 8; sample++) {
          const distance = runwayLength * (sample / 8)
          const px = start.x + x * distance
          const py = start.y + y * distance
          clearance = Math.min(clearance, px - 22, width - 22 - px, py - 22, LAYOUT.height - 22 - py)
          for (const obstacle of obstacles) {
            clearance = Math.min(
              clearance,
              Math.hypot(px - obstacle.x, py - obstacle.y) - obstacle.radius - fishSize * 7 - 3,
            )
          }
        }
        const score = clearance - radius * 0.06
        if (score > best.score) best = { start, direction: { x, y }, score }
      }
    }
  }
  return { start: best.start, direction: best.direction }
}

function returnPointOpen(
  point: Point,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): boolean {
  if (point.x < 12 || point.x > width - 12 || point.y < 12 || point.y > LAYOUT.height - 12) return false
  return obstacles.every(obstacle =>
    Math.hypot(point.x - obstacle.x, point.y - obstacle.y) >= obstacle.radius + fishSize * 4 + 2,
  )
}

function constrainReturnPoint(
  point: Point,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point {
  const constrained = {
    x: Math.max(12.1, Math.min(width - 12.1, point.x)),
    y: Math.max(12.1, Math.min(LAYOUT.height - 12.1, point.y)),
  }
  for (let pass = 0; pass < 10; pass++) {
    let moved = false
    for (const obstacle of obstacles) {
      const dx = constrained.x - obstacle.x
      const dy = constrained.y - obstacle.y
      const distance = Math.hypot(dx, dy)
      const clearance = obstacle.radius + fishSize * 4 + 2.1
      if (distance >= clearance) continue
      const normalX = distance > 1e-6 ? dx / distance : 1
      const normalY = distance > 1e-6 ? dy / distance : 0
      constrained.x = obstacle.x + normalX * clearance
      constrained.y = obstacle.y + normalY * clearance
      moved = true
    }
    if (!moved) break
  }
  return constrained
}

function returnSegmentOpen(
  start: Point,
  end: Point,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): boolean {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  const samples = Math.max(1, Math.ceil(length / 4))
  for (let sample = 1; sample <= samples; sample++) {
    const progress = sample / samples
    if (!returnPointOpen(
      {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      },
      fishSize,
      width,
      obstacles,
    )) return false
  }
  return true
}

function returnRoute(
  start: Point,
  goal: Point,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point[] {
  if (returnSegmentOpen(start, goal, fishSize, width, obstacles)) return [{ ...start }, { ...goal }]

  // A small deterministic A* grid keeps the closing path out of ice and plant geometry.
  const spacing = 10
  const inset = 12
  const columns = Math.floor((width - inset * 2) / spacing) + 1
  const rows = Math.floor((LAYOUT.height - inset * 2) / spacing) + 1
  const points = Array.from({ length: columns * rows }, (_, index) => ({
    x: inset + (index % columns) * spacing,
    y: inset + Math.floor(index / columns) * spacing,
  }))
  const open = points.map(point => returnPointOpen(point, fishSize, width, obstacles))
  const connector = (point: Point) => {
    const candidates = points
      .map((candidate, index) => ({ index, distance: Math.hypot(candidate.x - point.x, candidate.y - point.y) }))
      .filter(candidate => open[candidate.index])
      .sort((a, b) => a.distance - b.distance)
    return candidates.find(candidate =>
      returnSegmentOpen(point, points[candidate.index], fishSize, width, obstacles),
    )?.index
  }
  const startIndex = connector(start)
  const goalIndex = connector(goal)
  if (startIndex === undefined || goalIndex === undefined) return [{ ...start }, { ...goal }]

  const costs = new Array(points.length).fill(Infinity)
  const estimates = new Array(points.length).fill(Infinity)
  const previous = new Int32Array(points.length).fill(-1)
  const closed = new Uint8Array(points.length)
  const heap: Array<{ index: number; score: number }> = []
  const push = (entry: { index: number; score: number }) => {
    heap.push(entry)
    let index = heap.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (heap[parent].score <= entry.score) break
      heap[index] = heap[parent]
      index = parent
    }
    heap[index] = entry
  }
  const pop = () => {
    const first = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= heap.length) break
        const child = right < heap.length && heap[right].score < heap[left].score ? right : left
        if (heap[child].score >= last.score) break
        heap[index] = heap[child]
        index = child
      }
      heap[index] = last
    }
    return first
  }

  costs[startIndex] = 0
  estimates[startIndex] = Math.hypot(points[startIndex].x - goal.x, points[startIndex].y - goal.y)
  push({ index: startIndex, score: estimates[startIndex] })
  const neighbors = [-1, 0, 1]
  while (heap.length > 0) {
    const current = pop()
    if (!current || closed[current.index] || current.score > estimates[current.index] + 1e-9) continue
    if (current.index === goalIndex) break
    closed[current.index] = 1
    const column = current.index % columns
    const row = Math.floor(current.index / columns)
    for (const rowOffset of neighbors) {
      for (const columnOffset of neighbors) {
        if (rowOffset === 0 && columnOffset === 0) continue
        const nextColumn = column + columnOffset
        const nextRow = row + rowOffset
        if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue
        const next = nextRow * columns + nextColumn
        if (!open[next] || closed[next]) continue
        if (!returnSegmentOpen(points[current.index], points[next], fishSize, width, obstacles)) continue
        const move = rowOffset !== 0 && columnOffset !== 0 ? Math.SQRT2 * spacing : spacing
        const cost = costs[current.index] + move
        if (cost >= costs[next]) continue
        costs[next] = cost
        previous[next] = current.index
        estimates[next] = cost + Math.hypot(points[next].x - goal.x, points[next].y - goal.y)
        push({ index: next, score: estimates[next] })
      }
    }
  }

  if (!Number.isFinite(costs[goalIndex])) return [{ ...start }, { ...goal }]
  const gridRoute: Point[] = []
  for (let index = goalIndex; index >= 0; index = previous[index]) {
    gridRoute.push(points[index])
    if (index === startIndex) break
  }
  gridRoute.reverse()
  const route = [{ ...start }, ...gridRoute, { ...goal }]
  const simplified = [route[0]]
  let anchor = 0
  while (anchor < route.length - 1) {
    let next = route.length - 1
    while (
      next > anchor + 1 &&
      !returnSegmentOpen(route[anchor], route[next], fishSize, width, obstacles)
    ) next--
    simplified.push(route[next])
    anchor = next
  }
  return simplified
}

function returnLead(
  start: Point,
  velocity: Point,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point {
  for (const seconds of [0.5, 0.36, 0.24, 0.14]) {
    const lead = { x: start.x + velocity.x * seconds, y: start.y + velocity.y * seconds }
    if (returnSegmentOpen(start, lead, fishSize, width, obstacles)) return lead
  }
  return { ...start }
}

function roundedReturnRoute(
  route: Point[],
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point[] {
  if (route.length < 3) return route
  const rounded = [{ ...route[0] }]
  const append = (point: Point) => {
    if (Math.hypot(point.x - rounded.at(-1)!.x, point.y - rounded.at(-1)!.y) > 0.05) rounded.push(point)
  }

  for (let index = 1; index < route.length - 1; index++) {
    const previous = route[index - 1]
    const corner = route[index]
    const next = route[index + 1]
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    if (incoming < 0.5 || outgoing < 0.5) continue

    let accepted: Point[] | null = null
    const maximumTrim = Math.min(24 + fishSize * 4, incoming * 0.46, outgoing * 0.46)
    for (const scale of [1, 0.72, 0.48, 0.28]) {
      const trim = maximumTrim * scale
      const before = {
        x: corner.x + ((previous.x - corner.x) * trim) / incoming,
        y: corner.y + ((previous.y - corner.y) * trim) / incoming,
      }
      const after = {
        x: corner.x + ((next.x - corner.x) * trim) / outgoing,
        y: corner.y + ((next.y - corner.y) * trim) / outgoing,
      }
      const candidate = [before]
      for (let sample = 1; sample <= 10; sample++) {
        const progress = sample / 10
        const inverse = 1 - progress
        candidate.push({
          x: inverse * inverse * before.x + 2 * inverse * progress * corner.x + progress * progress * after.x,
          y: inverse * inverse * before.y + 2 * inverse * progress * corner.y + progress * progress * after.y,
        })
      }
      const path = [rounded.at(-1)!, ...candidate, next]
      if (path.slice(1).every((point, pathIndex) =>
        returnSegmentOpen(path[pathIndex], point, fishSize, width, obstacles),
      )) {
        accepted = candidate
        break
      }
    }
    if (accepted) accepted.forEach(append)
    else append({ ...corner })
  }
  append({ ...route.at(-1)! })
  return rounded
}

function softenedReturnRoute(
  route: Point[],
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point[] {
  const length = routeLength(route)
  const samples = Math.max(4, Math.ceil(length / 3))
  let softened = Array.from({ length: samples + 1 }, (_, index) => routePointAt(route, index / samples))

  for (let iteration = 0; iteration < 14; iteration++) {
    const candidate = softened.map((point, index) => {
      if (index < 2 || index > softened.length - 3) return { ...point }
      return constrainReturnPoint({
        x: softened[index - 1].x * 0.24 + point.x * 0.52 + softened[index + 1].x * 0.24,
        y: softened[index - 1].y * 0.24 + point.y * 0.52 + softened[index + 1].y * 0.24,
      }, fishSize, width, obstacles)
    })
    if (!candidate.slice(1).every((point, index) =>
      returnSegmentOpen(candidate[index], point, fishSize, width, obstacles),
    )) break
    softened = candidate
  }
  return softened
}

function returnTerminals(
  runwayStart: Point,
  loopVelocity: Point,
  fishId: number,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point[][] {
  const speed = Math.hypot(loopVelocity.x, loopVelocity.y) || 1
  const direction = { x: loopVelocity.x / speed, y: loopVelocity.y / speed }
  const normal = { x: -direction.y, y: direction.x }
  const preferredSide = fishId % 2 === 0 ? 1 : -1
  const terminals: Point[][] = []
  for (const side of [preferredSide, -preferredSide]) {
    for (const radius of [Math.min(22, speed * 0.48), 16, 11]) {
      const control = {
        x: runwayStart.x - direction.x * radius,
        y: runwayStart.y - direction.y * radius,
      }
      const curveStart = {
        x: control.x + normal.x * radius * side,
        y: control.y + normal.y * radius * side,
      }
      const approach = {
        x: curveStart.x + normal.x * radius * 0.72 * side,
        y: curveStart.y + normal.y * radius * 0.72 * side,
      }
      const guide = {
        x: approach.x + normal.x * radius * 1.5 * side,
        y: approach.y + normal.y * radius * 1.5 * side,
      }
      const terminal = [guide, approach, curveStart]
      for (let sample = 1; sample <= 8; sample++) {
        const progress = sample / 8
        const inverse = 1 - progress
        terminal.push({
          x: inverse * inverse * curveStart.x + 2 * inverse * progress * control.x + progress * progress * runwayStart.x,
          y: inverse * inverse * curveStart.y + 2 * inverse * progress * control.y + progress * progress * runwayStart.y,
        })
      }
      if (
        terminal.every(point => returnPointOpen(point, fishSize, width, obstacles)) &&
        terminal.slice(1).every((point, index) =>
          returnSegmentOpen(terminal[index], point, fishSize, width, obstacles),
        )
      ) terminals.push(terminal)
    }
  }

  const entry = {
    x: runwayStart.x - loopVelocity.x * 0.55,
    y: runwayStart.y - loopVelocity.y * 0.55,
  }
  terminals.push([entry, { ...runwayStart }])
  return terminals
}

function routeLength(route: Point[]): number {
  let length = 0
  for (let index = 1; index < route.length; index++) {
    length += Math.hypot(route[index].x - route[index - 1].x, route[index].y - route[index - 1].y)
  }
  return length
}

function routePointAt(route: Point[], progress: number): Point {
  const total = routeLength(route)
  let remaining = total * Math.max(0, Math.min(1, progress))
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1]
    const end = route[index]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (remaining <= length || index === route.length - 1) {
      const local = length <= 1e-9 ? 1 : Math.min(1, remaining / length)
      return { x: start.x + (end.x - start.x) * local, y: start.y + (end.y - start.y) * local }
    }
    remaining -= length
  }
  return { ...route.at(-1)! }
}

function separatedReturnRoute(
  route: Point[],
  laneOffset: number,
  fishSize: number,
  width: number,
  obstacles: PondObstacleSpec[],
): Point[] {
  const length = routeLength(route)
  const samples = Math.max(2, Math.ceil(length / 5))
  const dense = Array.from({ length: samples + 1 }, (_, index) => routePointAt(route, index / samples))
  if (Math.abs(laneOffset) < 0.1) return dense

  for (const scale of [1, 0.68, 0.36]) {
    const candidate = dense.map((point, index) => {
      const progress = index / samples
      if (index === 0 || index === samples) return { ...point }
      const previous = dense[index - 1]
      const next = dense[index + 1]
      const tangentX = next.x - previous.x
      const tangentY = next.y - previous.y
      const tangentLength = Math.hypot(tangentX, tangentY) || 1
      const smoothstep = (value: number) => value * value * (3 - 2 * value)
      const envelope = smoothstep(Math.min(1, progress / 0.2))
        * smoothstep(Math.min(1, (1 - progress) / 0.2))
      const offset = laneOffset * scale * envelope
      return {
        x: point.x + (-tangentY / tangentLength) * offset,
        y: point.y + (tangentX / tangentLength) * offset,
      }
    })
    if (candidate.slice(1).every((point, index) =>
      returnSegmentOpen(candidate[index], point, fishSize, width, obstacles),
    )) return candidate
  }
  return dense
}

function phasedReturnProgress(progress: number, phase: number): number {
  const bounded = Math.max(0, Math.min(1, progress))
  return Math.max(0, Math.min(1, bounded + phase * Math.sin(Math.PI * bounded) ** 2))
}

function returnTimingControls(startDerivative: number, endDerivative: number): number[] {
  const degree = Math.max(5, Math.ceil(startDerivative + endDerivative) + 1)
  const first = Math.max(0, Math.min(1, startDerivative / degree))
  const penultimate = Math.max(first, Math.min(1, 1 - endDerivative / degree))
  return Array.from({ length: degree + 1 }, (_, index) => {
    if (index === 0) return 0
    if (index === degree) return 1
    const progress = (index - 1) / Math.max(1, degree - 2)
    return first + (penultimate - first) * progress
  })
}

function timedReturnProgress(progress: number, controls: number[]): number {
  const bounded = Math.max(0, Math.min(1, progress))
  const values = [...controls]
  for (let level = values.length - 1; level > 0; level--) {
    for (let index = 0; index < level; index++) {
      values[index] = values[index] * (1 - bounded) + values[index + 1] * bounded
    }
  }
  return values[0]
}

function maximumRouteTurn(route: Point[]): number {
  let maximum = 0
  for (let index = 2; index < route.length; index++) {
    const first = {
      x: route[index - 1].x - route[index - 2].x,
      y: route[index - 1].y - route[index - 2].y,
    }
    const second = {
      x: route[index].x - route[index - 1].x,
      y: route[index].y - route[index - 1].y,
    }
    const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y)
    if (denominator < 0.01) continue
    const cosine = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator))
    maximum = Math.max(maximum, Math.acos(cosine))
  }
  return maximum
}

function routeClearance(
  route: Point[],
  phase: number,
  others: Array<{ route: Point[]; phase: number }>,
): number {
  let minimum = Infinity
  for (let sample = 2; sample <= 18; sample++) {
    const progress = sample / 20
    const point = routePointAt(route, phasedReturnProgress(progress, phase))
    for (const other of others) {
      const otherPoint = routePointAt(other.route, phasedReturnProgress(progress, other.phase))
      minimum = Math.min(minimum, Math.hypot(point.x - otherPoint.x, point.y - otherPoint.y))
    }
  }
  return minimum
}

export function plan(grid: Grid, seed: string, identities?: FishIdentity[], environment?: PondEnvironment): Plan {
  const r = rng('plan:' + seed)
  const width = svgWidth(grid.weeks)
  const stats = ecosystemStats(grid)
  const obstacles = pondObstacleLayout(width, seed, environment)
  const targets: Target[] = grid.cells
    .filter(c => c.level > 0)
    .map(c => ({
      cell: c.week * 7 + c.day,
      ...cellCenter(c.week, c.day),
      level: c.level,
      energy: cellEnergy(c),
    }))

  const fishCount = identities && identities.length > 0 ? identities.length : desiredPopulation(stats)
  const energyDensity = Math.min(1, stats.energyDensity / 7)
  const koiAffinity = Math.min(0.78, 0.26 + energyDensity * 0.34 + stats.consistency * 0.42)
  const fishes: FishPlan[] = []
  for (let i = 0; i < fishCount; i++) {
    const identity = identities?.[i]
    const isKoi = identity ? identity.species === 'koi' : i === 0 || r() < koiAffinity
    const baseSize = identity
      ? identity.baseSize
      : i === 0
        ? 1.08 + energyDensity * 0.2 + r() * 0.08
        : isKoi
          ? 0.68 + energyDensity * 0.14 + r() * 0.12
          : 0.9 + stats.consistency * 0.18 + r() * 0.14
    const lifetimeEnergy = identity?.lifetimeEnergy ?? 0
    const size = baseSize + Math.min(0.22, Math.log1p(lifetimeEnergy) * 0.024)
    const start = {
      x: LAYOUT.padX + ((i + 0.5) / fishCount) * (width - LAYOUT.padX * 2),
      y: LAYOUT.gridY + 10 + r() * (7 * LAYOUT.cell - 20),
    }
    resolveIceCollision(start, obstacles)
    fishes.push({
      id: i,
      key: identity?.key ?? `${seed}-${i}`,
      species: isKoi ? 'koi' : 'minnow',
      size,
      energy: 0,
      lifetimeEnergy,
      start,
      waypoints: [],
    })
  }

  const sims: Sim[] = fishes.map(f => {
    const preferredAngle = r() * Math.PI * 2
    const maxSpeed =
      f.species === 'koi' ? 58 - 9 * f.size + stats.recentEnergy * 3 : 68 + stats.burstiness * 10
    const initialSpeed = maxSpeed * 0.7
    const runwayDuration = 1.4
    const setup = loopSetup(
      f.start,
      preferredAngle,
      initialSpeed * (runwayDuration + 0.55),
      f.size,
      width,
      obstacles,
    )
    f.start.x = setup.start.x
    f.start.y = setup.start.y
    const direction = setup.direction
    const loopVelocity = { x: direction.x * initialSpeed, y: direction.y * initialSpeed }
    return {
      f,
      pos: { ...f.start },
      vel: { ...loopVelocity },
      loopVelocity,
      runwayStart: {
        x: f.start.x - loopVelocity.x * runwayDuration,
        y: f.start.y - loopVelocity.y * runwayDuration,
      },
      target: null,
      targetAge: 0,
      wander: r() * Math.PI * 2,
      maxSpeed,
      maxForce: f.species === 'koi' ? 105 : 145 + stats.burstiness * 20,
      satiety: 0,
    }
  })

  const step = (s: Sim, tx: number, ty: number, arrive: boolean) => {
    s.satiety = Math.max(0, s.satiety - SIM_DT * 0.62)
    const speed = s.maxSpeed * (1 - Math.min(0.2, (s.satiety / 16) * 0.2))
    const dx = tx - s.pos.x
    const dy = ty - s.pos.y
    const d = Math.hypot(dx, dy) || 1
    const desired = arrive ? speed * Math.min(1, Math.max(0.62, d / 22)) : speed
    let ax = (dx / d) * desired - s.vel.x
    let ay = (dy / d) * desired - s.vel.y
    const am = Math.hypot(ax, ay) || 1
    const cap = Math.min(s.maxForce, am * 5)
    ax = (ax / am) * cap
    ay = (ay / am) * cap

    s.wander += (r() - 0.5) * (0.24 + stats.burstiness * 0.16)
    const sp = Math.hypot(s.vel.x, s.vel.y) || 1
    const wAmp = s.maxForce * (s.f.species === 'koi' ? 0.13 : 0.18) * Math.sin(s.wander)
    ax += (-s.vel.y / sp) * wAmp
    ay += (s.vel.x / sp) * wAmp

    for (const obstacle of obstacles) {
      const lookAhead = s.f.species === 'koi' ? 0.46 : 0.32
      const futureX = s.pos.x + s.vel.x * lookAhead
      const futureY = s.pos.y + s.vel.y * lookAhead
      const currentDistance = Math.hypot(s.pos.x - obstacle.x, s.pos.y - obstacle.y)
      const futureDistance = Math.hypot(futureX - obstacle.x, futureY - obstacle.y)
      const useFuture = futureDistance < currentDistance
      const ox = (useFuture ? futureX : s.pos.x) - obstacle.x
      const oy = (useFuture ? futureY : s.pos.y) - obstacle.y
      const od = Math.hypot(ox, oy) || 1
      const clearance = obstacle.radius + (obstacle.kind === 'ice' ? 10 : 8) + s.f.size * 7
      if (od < clearance) {
        const strength = 1 - od / clearance
        const push = s.maxForce * (obstacle.kind === 'ice' ? 3.6 : 2.1) * strength * strength
        ax += (ox / od) * push
        ay += (oy / od) * push
        const side = s.f.id % 2 === 0 ? 1 : -1
        ax += (-oy / od) * push * 0.32 * side
        ay += (ox / od) * push * 0.32 * side
      }
    }

    let schoolX = 0
    let schoolY = 0
    let alignX = 0
    let alignY = 0
    let schoolmates = 0
    for (const other of sims) {
      if (other === s) continue
      const prediction = 0.28
      const sx = s.pos.x + s.vel.x * prediction - (other.pos.x + other.vel.x * prediction)
      const sy = s.pos.y + s.vel.y * prediction - (other.pos.y + other.vel.y * prediction)
      const sd = Math.hypot(sx, sy) || 1
      const separation = 17 + (s.f.size + other.f.size) * 4
      if (sd < separation) {
        const push = s.maxForce * (1 - sd / separation) * (s.f.species === 'koi' ? 1.1 : 0.82)
        ax += (sx / sd) * push
        ay += (sy / sd) * push
      }
      if (s.f.species === 'minnow' && other.f.species === 'minnow' && sd < 88) {
        schoolX += other.pos.x
        schoolY += other.pos.y
        alignX += other.vel.x
        alignY += other.vel.y
        schoolmates++
      }
    }
    if (schoolmates > 0) {
      const cohesion = 0.46 + stats.consistency * 0.45
      ax += (schoolX / schoolmates - s.pos.x) * cohesion
      ay += (schoolY / schoolmates - s.pos.y) * cohesion
      ax += (alignX / schoolmates - s.vel.x) * 0.12
      ay += (alignY / schoolmates - s.vel.y) * 0.12
    }

    const M = 24
    const W = s.maxForce * 1.6
    if (s.pos.x < M) ax += W * (1 - s.pos.x / M)
    if (s.pos.x > width - M) ax -= W * (1 - (width - s.pos.x) / M)
    if (s.pos.y < M) ay += W * (1 - s.pos.y / M)
    if (s.pos.y > LAYOUT.height - M) ay -= W * (1 - (LAYOUT.height - s.pos.y) / M)

    const force = Math.hypot(ax, ay) || 1
    const forceCap = s.maxForce * 2.15
    if (force > forceCap) {
      ax = (ax / force) * forceCap
      ay = (ay / force) * forceCap
    }

    s.vel.x += ax * SIM_DT
    s.vel.y += ay * SIM_DT
    const v = Math.hypot(s.vel.x, s.vel.y) || 1
    const vc = Math.min(speed, Math.max(11, v))
    s.vel.x = (s.vel.x / v) * vc
    s.vel.y = (s.vel.y / v) * vc
    s.pos.x += s.vel.x * SIM_DT
    s.pos.y += s.vel.y * SIM_DT

    const beforeCollision = { ...s.pos }
    if (resolveIceCollision(s.pos, obstacles)) {
      const shiftX = s.pos.x - beforeCollision.x
      const shiftY = s.pos.y - beforeCollision.y
      const shiftLength = Math.hypot(shiftX, shiftY) || 1
      const nx = shiftX / shiftLength
      const ny = shiftY / shiftLength
      const inwardVelocity = s.vel.x * nx + s.vel.y * ny
      if (inwardVelocity < 0) {
        s.vel.x -= inwardVelocity * nx
        s.vel.y -= inwardVelocity * ny
      }
    }
  }

  const remaining = [...targets]
  const eats: EatEvent[] = []
  const claim = (s: Sim): Target | null => {
    if (remaining.length === 0) return null
    const scored = remaining
      .map((target, i) => {
        const distance = Math.hypot(target.x - s.pos.x, target.y - s.pos.y)
        const energyBias =
          s.f.species === 'koi' ? 1 / (1 + target.energy * 0.11) : 1 + Math.max(0, target.energy - 2) * 0.045
        return { i, d: distance * energyBias }
      })
      .sort((a, b) => a.d - b.d)
    const pick = scored[Math.floor(r() * r() * Math.min(4, scored.length))]
    return remaining.splice(pick.i, 1)[0]
  }

  let t = 0
  let nextSample = 0
  const sample = () => {
    if (t >= nextSample - 1e-9) {
      for (const s of sims) {
        s.f.waypoints.push({ t, x: s.pos.x, y: s.pos.y, satiety: Math.min(1, s.satiety / 16) })
      }
      nextSample += SAMPLE_DT
    }
  }

  const launchDuration = 0.45
  while (t < launchDuration - 1e-9) {
    sims.forEach(s => {
      s.pos.x = s.f.start.x + s.loopVelocity.x * t
      s.pos.y = s.f.start.y + s.loopVelocity.y * t
      s.vel.x = s.loopVelocity.x
      s.vel.y = s.loopVelocity.y
    })
    sample()
    t += SIM_DT
  }

  if (targets.length > 0) {
    while ((remaining.length > 0 || sims.some(s => s.target)) && t < 600) {
      sample()
      for (const s of sims) {
        if (!s.target) {
          s.target = claim(s)
          s.targetAge = 0
        }
        if (!s.target) {
          step(s, s.f.start.x, s.f.start.y, true)
          continue
        }
        s.targetAge += SIM_DT
        const eatR = 7 + Math.max(0, s.targetAge - 6) * 2
        step(s, s.target.x, s.target.y, true)
        if (Math.hypot(s.target.x - s.pos.x, s.target.y - s.pos.y) < eatR) {
          s.satiety = Math.min(16, s.satiety + s.target.energy)
          s.f.energy += s.target.energy
          eats.push({
            cell: s.target.cell,
            fish: s.f.id,
            t: t + SIM_DT,
            level: s.target.level,
            energy: s.target.energy,
            x: s.target.x,
            y: s.target.y,
          })
          s.target = null
        }
      }
      t += SIM_DT
    }
  }

  const feedEnd = t
  const minimumDuration = Math.max(24, (feedEnd + 1.5) / ACTIVE_FRACTION)
  const runwayDuration = 1.4
  const departureStarts = sims.map(s => ({
    x: Math.max(24, Math.min(width - 24, s.pos.x + s.vel.x * 2.2)),
    y: Math.max(24, Math.min(LAYOUT.height - 24, s.pos.y + s.vel.y * 2.2)),
  }))
  const departureStartTime = t
  const departureEndTime = t + 1.1
  while (t < departureEndTime - 1e-9) {
    sample()
    const progress = Math.max(0, Math.min(1, (t - departureStartTime) / 1.1))
    const blendProgress = Math.max(0, Math.min(1, (progress - 0.18) / 0.82))
    const blend = blendProgress * blendProgress * (3 - 2 * blendProgress)
    sims.forEach((s, index) => step(
      s,
      departureStarts[index].x * (1 - blend) + s.runwayStart.x * blend,
      departureStarts[index].y * (1 - blend) + s.runwayStart.y * blend,
      true,
    ))
    t += SIM_DT
  }
  const returnPhases = sims.map(s => (s.f.id - (sims.length - 1) / 2) * 0.04)
  const selectedRoutes: Array<{ route: Point[]; phase: number }> = []
  const returnRoutes = sims.map((s, fishIndex) => {
    const lead = returnLead(s.pos, s.vel, s.f.size, width, obstacles)
    const baseLane = (s.f.id - (sims.length - 1) / 2) * 6
    const laneOffsets = baseLane === 0
      ? [0, 7, -7, 11, -11]
      : [baseLane * 1.6, baseLane, baseLane * 0.55, -baseLane]
    let best: { route: Point[]; score: number } | null = null

    for (const terminal of returnTerminals(
      s.runwayStart,
      s.loopVelocity,
      s.f.id,
      s.f.size,
      width,
      obstacles,
    )) {
      const navigation = returnRoute(lead, terminal[0], s.f.size, width, obstacles)
      const mergePoints = terminal.length > 2 ? terminal.slice(1, 3) : terminal.slice(1)
      const merge = roundedReturnRoute(
        [{ ...s.pos }, ...navigation, ...mergePoints],
        s.f.size,
        width,
        obstacles,
      )
      const rounded = [...merge, ...terminal.slice(mergePoints.length + 1)]
      for (const laneOffset of laneOffsets) {
        const separated = separatedReturnRoute(rounded, laneOffset, s.f.size, width, obstacles)
        const route = softenedReturnRoute(separated, s.f.size, width, obstacles)
        const clearance = routeClearance(route, returnPhases[fishIndex], selectedRoutes)
        const separationPenalty = Number.isFinite(clearance) ? Math.max(0, 16 - clearance) * 0.4 : 0
        const score = maximumRouteTurn(route) + separationPenalty + routeLength(route) * 0.0002
        if (!best || score < best.score) best = { route, score }
      }
    }

    const route = best!.route
    selectedRoutes.push({ route, phase: returnPhases[fishIndex] })
    return route
  })
  const returnDuration = Math.max(
    2.4,
    minimumDuration - feedEnd,
    ...returnRoutes.map((route, index) => routeLength(route) / (sims[index].maxSpeed * 0.66)),
  )
  const returnTimings = sims.map((s, index) => {
    const length = routeLength(returnRoutes[index]) || 1
    return returnTimingControls(
      (Math.hypot(s.vel.x, s.vel.y) * returnDuration) / length,
      (Math.hypot(s.loopVelocity.x, s.loopVelocity.y) * returnDuration) / length,
    )
  })
  const returnStartTime = t
  const returnEndTime = returnStartTime + returnDuration
  while (t < returnEndTime - 1e-9) {
    const progress = (t - returnStartTime) / returnDuration
    const returnProgresses = sims.map((_, index) => {
      const phased = phasedReturnProgress(progress, returnPhases[index])
      return timedReturnProgress(phased, returnTimings[index])
    })
    sims.forEach((s, index) => {
      const point = routePointAt(returnRoutes[index], returnProgresses[index])
      s.pos.x = point.x
      s.pos.y = point.y
      s.satiety = Math.max(0, s.satiety - SIM_DT * 0.62)
    })
    sample()
    t += SIM_DT
  }
  t = returnEndTime
  sims.forEach(s => {
    s.pos.x = s.runwayStart.x
    s.pos.y = s.runwayStart.y
    s.satiety = 0
  })

  const runwayStartTime = t
  const duration = runwayStartTime + runwayDuration
  while (t < duration - 1e-9) {
    const progress = Math.min(1, (t - runwayStartTime) / runwayDuration)
    sims.forEach(s => {
      s.pos.x = s.runwayStart.x + (s.f.start.x - s.runwayStart.x) * progress
      s.pos.y = s.runwayStart.y + (s.f.start.y - s.runwayStart.y) * progress
      s.vel.x = s.loopVelocity.x
      s.vel.y = s.loopVelocity.y
      s.satiety = 0
    })
    sample()
    t += SIM_DT
  }

  for (const f of fishes) {
    const last = f.waypoints[f.waypoints.length - 1]
    if (!last || last.t < duration - 1e-6) {
      f.waypoints.push({ t: duration, x: f.start.x, y: f.start.y, satiety: 0 })
    } else {
      last.t = duration
      last.x = f.start.x
      last.y = f.start.y
      last.satiety = 0
    }
  }

  return { duration, fishes, eats }
}

export function longestStreak(grid: Grid): number {
  const ordered = [...grid.cells].sort((a, b) => a.week * 7 + a.day - (b.week * 7 + b.day))
  let best = 0
  let cur = 0
  for (const c of ordered) {
    cur = c.count > 0 ? cur + 1 : 0
    if (cur > best) best = cur
  }
  return best
}

export function longestGap(grid: Grid): { len: number; centerWeek: number } {
  const ordered = [...grid.cells].sort((a, b) => a.week * 7 + a.day - (b.week * 7 + b.day))
  let best = { len: 0, centerWeek: 0 }
  let curLen = 0
  let curStart = 0
  ordered.forEach((c, i) => {
    if (c.count === 0) {
      if (curLen === 0) curStart = i
      curLen++
      if (curLen > best.len) best = { len: curLen, centerWeek: Math.floor((curStart + i) / 2 / 7) }
    } else {
      curLen = 0
    }
  })
  return best
}
