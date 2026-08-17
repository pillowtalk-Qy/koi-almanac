import type { Plan, Point } from './types'
import { fishPointAt, fishStaticTrail } from './render/fish'

export interface MotionAudit {
  maximumReturnSpeed: number
  maximumReturnAcceleration: number
  maximumReturnTurnDegrees: number
  minimumPairDistance: number | null
  maximumSeamStep: number
  maximumSeamHeadingDeltaDegrees: number
  minimumSeamBodyLength: number
  maximumSeamBodyLengthDelta: number
}

export const MOTION_AUDIT_LIMITS = {
  maximumReturnSpeed: 82,
  maximumReturnAcceleration: 420,
  maximumReturnTurnDegrees: 75,
  minimumPairDistance: 9,
  maximumSeamStep: 4,
  maximumSeamHeadingDeltaDegrees: 8,
  minimumSeamBodyLength: 15,
  maximumSeamBodyLengthDelta: 1.5,
} as const

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

function headingDeltaDegrees(first: Point, second: Point): number {
  const firstHeading = Math.atan2(first.y, first.x)
  const secondHeading = Math.atan2(second.y, second.x)
  let delta = Math.abs(firstHeading - secondHeading)
  if (delta > Math.PI) delta = Math.PI * 2 - delta
  return (delta * 180) / Math.PI
}

export function auditMotion(plan: Plan): MotionAudit {
  const feedEnd = plan.eats.length > 0 ? Math.max(...plan.eats.map(event => event.t)) : 0
  let maximumReturnSpeed = 0
  let maximumReturnAcceleration = 0
  let maximumReturnTurnDegrees = 0
  let minimumPairDistance = Infinity
  let maximumSeamStep = 0
  let maximumSeamHeadingDeltaDegrees = 0
  let minimumSeamBodyLength = Infinity
  let maximumSeamBodyLengthDelta = 0

  for (const fish of plan.fishes) {
    const returnWaypoints = fish.waypoints.filter(waypoint => waypoint.t >= feedEnd - 0.01)
    let previousVelocity: Point | null = null
    for (let index = 1; index < returnWaypoints.length; index++) {
      const previous = returnWaypoints[index - 1]
      const current = returnWaypoints[index]
      const deltaTime = current.t - previous.t
      if (deltaTime <= 0) continue
      const velocity = {
        x: (current.x - previous.x) / deltaTime,
        y: (current.y - previous.y) / deltaTime,
      }
      const speed = Math.hypot(velocity.x, velocity.y)
      maximumReturnSpeed = Math.max(maximumReturnSpeed, speed)
      if (previousVelocity) {
        const previousSpeed = Math.hypot(previousVelocity.x, previousVelocity.y)
        maximumReturnAcceleration = Math.max(
          maximumReturnAcceleration,
          Math.hypot(velocity.x - previousVelocity.x, velocity.y - previousVelocity.y) / deltaTime,
        )
        if (speed > 6 && previousSpeed > 6) {
          maximumReturnTurnDegrees = Math.max(
            maximumReturnTurnDegrees,
            headingDeltaDegrees(previousVelocity, velocity),
          )
        }
      }
      previousVelocity = velocity
    }

    const before = fishPointAt(fish, plan.duration - 0.02, plan.duration)
    const after = fishPointAt(fish, 0.02, plan.duration)
    maximumSeamStep = Math.max(maximumSeamStep, distance(before, after))
    const beforeHeading = {
      x: before.x - fishPointAt(fish, plan.duration - 0.06, plan.duration).x,
      y: before.y - fishPointAt(fish, plan.duration - 0.06, plan.duration).y,
    }
    const afterPoint = fishPointAt(fish, 0.06, plan.duration)
    const afterHeading = { x: afterPoint.x - after.x, y: afterPoint.y - after.y }
    maximumSeamHeadingDeltaDegrees = Math.max(
      maximumSeamHeadingDeltaDegrees,
      headingDeltaDegrees(beforeHeading, afterHeading),
    )

    const bodyLengths = [plan.duration - 0.02, 0.02].map(time => {
      const trail = fishStaticTrail(fish, time, plan.duration)
      return distance(trail[0], trail.at(-1)!)
    })
    minimumSeamBodyLength = Math.min(minimumSeamBodyLength, ...bodyLengths)
    maximumSeamBodyLengthDelta = Math.max(
      maximumSeamBodyLengthDelta,
      Math.abs(bodyLengths[0] - bodyLengths[1]),
    )
  }

  if (plan.fishes.length > 1) {
    for (let time = feedEnd + 1.1; time < plan.duration - 1.4; time += 0.1) {
      for (let first = 0; first < plan.fishes.length; first++) {
        for (let second = first + 1; second < plan.fishes.length; second++) {
          minimumPairDistance = Math.min(
            minimumPairDistance,
            distance(
              fishPointAt(plan.fishes[first], time, plan.duration),
              fishPointAt(plan.fishes[second], time, plan.duration),
            ),
          )
        }
      }
    }
  }

  return {
    maximumReturnSpeed,
    maximumReturnAcceleration,
    maximumReturnTurnDegrees,
    minimumPairDistance: Number.isFinite(minimumPairDistance) ? minimumPairDistance : null,
    maximumSeamStep,
    maximumSeamHeadingDeltaDegrees,
    minimumSeamBodyLength,
    maximumSeamBodyLengthDelta,
  }
}

export function motionAuditFailures(audit: MotionAudit): string[] {
  const failures: string[] = []
  const maximum = (
    key: keyof MotionAudit,
    value: number,
    limit: number,
  ) => {
    if (value >= limit) failures.push(`${key} ${value.toFixed(3)} >= ${limit}`)
  }
  const minimum = (
    key: keyof MotionAudit,
    value: number,
    limit: number,
  ) => {
    if (value <= limit) failures.push(`${key} ${value.toFixed(3)} <= ${limit}`)
  }

  maximum('maximumReturnSpeed', audit.maximumReturnSpeed, MOTION_AUDIT_LIMITS.maximumReturnSpeed)
  maximum(
    'maximumReturnAcceleration',
    audit.maximumReturnAcceleration,
    MOTION_AUDIT_LIMITS.maximumReturnAcceleration,
  )
  maximum(
    'maximumReturnTurnDegrees',
    audit.maximumReturnTurnDegrees,
    MOTION_AUDIT_LIMITS.maximumReturnTurnDegrees,
  )
  if (audit.minimumPairDistance !== null) {
    minimum('minimumPairDistance', audit.minimumPairDistance, MOTION_AUDIT_LIMITS.minimumPairDistance)
  }
  maximum('maximumSeamStep', audit.maximumSeamStep, MOTION_AUDIT_LIMITS.maximumSeamStep)
  maximum(
    'maximumSeamHeadingDeltaDegrees',
    audit.maximumSeamHeadingDeltaDegrees,
    MOTION_AUDIT_LIMITS.maximumSeamHeadingDeltaDegrees,
  )
  minimum('minimumSeamBodyLength', audit.minimumSeamBodyLength, MOTION_AUDIT_LIMITS.minimumSeamBodyLength)
  maximum(
    'maximumSeamBodyLengthDelta',
    audit.maximumSeamBodyLengthDelta,
    MOTION_AUDIT_LIMITS.maximumSeamBodyLengthDelta,
  )
  return failures
}
