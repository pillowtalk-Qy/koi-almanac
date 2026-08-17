export const LAYOUT = {
  cell: 13,
  padX: 24,
  gridY: 42,
  height: 186,
} as const

export const svgWidth = (weeks: number) => LAYOUT.padX * 2 + weeks * LAYOUT.cell

export const cellCenter = (week: number, day: number) => ({
  x: LAYOUT.padX + week * LAYOUT.cell + LAYOUT.cell / 2,
  y: LAYOUT.gridY + day * LAYOUT.cell + LAYOUT.cell / 2,
})
