export interface Cell {
  week: number
  day: number
  date: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface Grid {
  weeks: number
  cells: Cell[]
}

export interface Point {
  x: number
  y: number
}

export interface Waypoint extends Point {
  t: number
  satiety: number
}

export type Species = 'koi' | 'minnow'

export interface FishIdentity {
  key: string
  species: Species
  baseSize: number
  lifetimeEnergy: number
  bornOn: string
}

export interface FishPlan {
  id: number
  key: string
  species: Species
  size: number
  energy: number
  lifetimeEnergy: number
  start: Point
  waypoints: Waypoint[]
}

export interface EatEvent {
  cell: number
  fish: number
  t: number
  level: number
  energy: number
  x: number
  y: number
}

export interface Plan {
  duration: number
  fishes: FishPlan[]
  eats: EatEvent[]
}
