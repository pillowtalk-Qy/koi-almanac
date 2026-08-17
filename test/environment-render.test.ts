import { describe, expect, it } from 'vitest'
import { demoGrid } from '../src/demo'
import { deriveEnvironment, momentFromText } from '../src/environment'
import { svgWidth } from '../src/layout'
import { plan } from '../src/planner'
import { fishSVG } from '../src/render/fish'
import { THEMES, themeForEnvironment } from '../src/render/palette'
import { renderSVG } from '../src/render/svg'

describe('environment-aware original renderer', () => {
  const grid = demoGrid('seasonal-render')
  const pondPlan = plan(grid, 'seasonal-render')

  it('does not add an environment layer to legacy outputs', () => {
    const { svg, meta } = renderSVG(grid, pondPlan, THEMES.light, 'seasonal-render')
    expect(svg).not.toContain('koipond-environment')
    expect(svg).not.toContain('spring pond growth')
    expect(meta.duration).toBeCloseTo(pondPlan.duration, 1)
  })

  it('embeds independently inspectable time and season metadata', () => {
    const environment = deriveEnvironment(momentFromText('2026-12-21', '23:30'), 'winter')
    const { svg, meta } = renderSVG(
      grid,
      pondPlan,
      themeForEnvironment(environment),
      'seasonal-render',
      { environment },
    )
    expect(svg).toContain('id="koipond-environment"')
    expect(svg).toContain('"season":"winter"')
    expect(svg).toContain('"moonPhase":')
    expect(svg).toContain('"currentDirection":')
    expect(svg.match(/data-pond-part="lily-pad"/g)).toHaveLength(1)
    expect(svg).toContain('data-seasonal-part="winter-ice"')
    expect(svg).not.toContain('data-seasonal-part="autumn-maple"')
    expect(meta.duration).toBeGreaterThan(pondPlan.duration)
  })

  it('uses physical seasonal markers while preserving the original pond language', () => {
    const spring = deriveEnvironment(momentFromText('2026-04-15', '12:00'), 'spring')
    const summer = deriveEnvironment(momentFromText('2026-07-15', '12:00'), 'summer')
    const autumn = deriveEnvironment(momentFromText('2026-10-15', '12:00'), 'autumn')
    const winter = deriveEnvironment(momentFromText('2026-01-15', '12:00'), 'winter')
    const springSvg = renderSVG(grid, pondPlan, themeForEnvironment(spring), 'seasonal-render', { environment: spring }).svg
    const summerSvg = renderSVG(grid, pondPlan, themeForEnvironment(summer), 'seasonal-render', { environment: summer }).svg
    const autumnSvg = renderSVG(grid, pondPlan, themeForEnvironment(autumn), 'seasonal-render', { environment: autumn }).svg
    const winterSvg = renderSVG(grid, pondPlan, themeForEnvironment(winter), 'seasonal-render', { environment: winter }).svg
    expect(springSvg).not.toBe(autumnSvg)
    expect(springSvg.match(/data-pond-part="lily-pad"/g)).toHaveLength(4)
    expect(springSvg).toContain('data-seasonal-part="spring-growth"')
    expect(springSvg.match(/class="spring-plant"/g)).toHaveLength(3)
    expect(springSvg.match(/class="spring-blade"/g)?.length).toBeGreaterThanOrEqual(15)
    expect(springSvg.match(/class="spring-bubble"/g)).toHaveLength(6)
    expect(springSvg).toContain('@keyframes spring-plant{')
    expect(springSvg).toContain('@keyframes spring-bubble{')
    expect(summerSvg).toContain('data-seasonal-part="summer-bloom"')
    expect(summerSvg).not.toContain('data-seasonal-part="spring-growth"')
    expect(summerSvg).toContain('data-lotus-state="open"')
    expect(summerSvg.match(/data-lotus-openness=/g)?.length).toBeGreaterThanOrEqual(3)
    expect(summerSvg.match(/data-lotus-motion="current-drift"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(summerSvg).toContain('data-lotus-drift-x=')
    expect(summerSvg).toContain('@keyframes summer-lotus-drift{')
    expect(summerSvg).not.toContain('data-seasonal-part="summer-fireflies"')
    expect(autumnSvg).toContain('data-seasonal-part="autumn-maple"')
    expect(autumnSvg).toContain('class="maple-wake"')
    expect(autumnSvg).toContain('class="maple-body"')
    expect(autumnSvg).toContain('--mx0:')
    expect(autumnSvg).toContain('--mx3:')
    expect(autumnSvg).toContain('@keyframes maple{')
    expect(autumnSvg.match(/data-pond-part="lily-pad"/g)).toHaveLength(3)
    expect(winterSvg).toContain('data-seasonal-part="winter-snowfall"')
    expect(winterSvg.match(/data-snow-landing="ice"/g)?.length).toBeGreaterThanOrEqual(4)
    expect(winterSvg.match(/data-snow-landing="water"/g)?.length).toBeGreaterThanOrEqual(12)
    expect(winterSvg).toContain('class="snow-settle"')
    expect(winterSvg).toContain('class="snow-melt"')
    expect(pondPlan.fishes.every(fish => springSvg.includes(`@keyframes fp${fish.id}`))).toBe(true)
    expect(pondPlan.fishes.every(fish => autumnSvg.includes(`@keyframes fp${fish.id}`))).toBe(true)
  })

  it('synchronizes the winter turtle with ice contact, tracks and water feedback', () => {
    const turtleGrid = {
      ...grid,
      cells: grid.cells.map(cell => ({ ...cell, count: 1, level: 1 as const })),
    }
    const turtlePlan = plan(turtleGrid, 'winter-turtle')
    const winter = deriveEnvironment(momentFromText('2026-12-21', '12:00'), 'winter')
    const { svg, meta } = renderSVG(
      turtleGrid,
      turtlePlan,
      themeForEnvironment(winter),
      'winter-turtle',
      { environment: winter },
    )

    expect(meta.turtle).toBe(true)
    expect(svg).toContain('data-pond-part="turtle-water-feedback"')
    expect(svg).toContain('class="turtle-body"')
    expect(svg).toContain('data-turtle-mount=')
    expect(svg).toContain('data-turtle-air=')
    expect(svg).toContain('data-turtle-impact=')
    expect(svg).toContain('class="turtle-shadow"')
    expect(svg).toContain('class="turtle-scale" transform="scale(1.1)"')
    expect(svg).toContain('class="paddle-phase paddle-front-left"')
    expect(svg).toContain('class="snow-track snow-track-0"')
    expect(svg).toContain('@keyframes turtle-body{')
    expect(svg).toContain('@keyframes turtle-shadow{')
    expect(svg).toContain('@keyframes turtle-front-paddle{')
    expect(svg).toContain('@keyframes turtle-rear-paddle{')
    expect(svg).toMatch(/translateY\(-6px\) rotate\(-?\d+(?:\.\d+)?deg\)/)
    expect(svg).toContain('@keyframes turtle-splash-out{')
    expect(svg).toContain('scale(1.08,0.86)')
    expect(svg).toContain('rotate(-16deg)')
    expect(svg).toContain('class="turtle-impact"')
    expect(svg.match(/class="turtle-droplet"/g)).toHaveLength(4)
    const turtleAnimation = svg.match(/animation:turtle ([\d.]+)s linear infinite;animation-delay:-([\d.]+)s/)
    const turtleDuration = Number(turtleAnimation?.[1])
    const turtleDelay = Number(turtleAnimation?.[2])
    const initialX = -40 + (svgWidth(turtleGrid.weeks) + 80) * (turtleDelay / turtleDuration)
    const approachY = svg.match(/@keyframes turtle\{0%\{[^}]+\}[\d.]+%\{transform:translate\([^,]+,([\d.]+)px\)/)?.[1]
    expect(turtleDelay).toBeGreaterThan(0)
    expect(initialX).toBeGreaterThanOrEqual(48)
    expect(initialX).toBeLessThan(svgWidth(turtleGrid.weeks) * 0.12)
    expect(Number(approachY)).toBeLessThanOrEqual(154)
    expect(svg).toContain('@keyframes snow-track-7{')
  })

  it('changes background shadow reach and softness with solar height', () => {
    const morning = deriveEnvironment(momentFromText('2026-10-15', '08:00'), 'autumn')
    const noon = deriveEnvironment(momentFromText('2026-10-15', '12:00'), 'autumn')
    const morningSvg = renderSVG(grid, pondPlan, themeForEnvironment(morning), 'seasonal-render', { environment: morning }).svg
    const noonSvg = renderSVG(grid, pondPlan, themeForEnvironment(noon), 'seasonal-render', { environment: noon }).svg
    const floorRule = (svg: string) => svg.match(/@keyframes floor\{[^@]+/)?.[0]
    const floorFilter = (svg: string) => svg.match(/<filter id="floorSoft"[^>]*>.*?<\/filter>/)?.[0]

    expect(floorRule(morningSvg)).not.toBe(floorRule(noonSvg))
    expect(floorFilter(morningSvg)).not.toBe(floorFilter(noonSvg))
  })

  it('preserves seasonal identity at night and closes summer lotus flowers', () => {
    const moment = momentFromText('2026-08-16', '00:00')
    const renders = (['spring', 'summer', 'autumn', 'winter'] as const).map(season => {
      const environment = deriveEnvironment(moment, season)
      return renderSVG(grid, pondPlan, themeForEnvironment(environment), 'seasonal-render', { environment }).svg
    })

    expect(new Set(renders).size).toBe(4)
    expect(renders[0]).toContain('data-seasonal-part="spring-growth"')
    expect(renders[0].match(/class="spring-plant"/g)).toHaveLength(3)
    expect(renders[0].match(/class="spring-bubble"/g)).toHaveLength(6)
    expect(renders[1]).toContain('data-seasonal-part="summer-bloom"')
    expect(renders[1]).toContain('data-seasonal-part="summer-fireflies"')
    expect(renders[1].match(/class="firefly-flight"/g)?.length).toBeGreaterThanOrEqual(10)
    expect(renders[1].match(/data-firefly-role="lotus-visitor"/g)?.length).toBeGreaterThanOrEqual(5)
    expect(renders[1]).toContain('data-firefly-index="0"')
    expect(renders[1].match(/class="lotus-visit"/g)?.length).toBeGreaterThanOrEqual(5)
    expect(renders[1]).toContain('@keyframes lotus-visit{')
    expect(renders[1]).toContain('data-lotus-state="sleeping"')
    expect(renders[1]).toContain('data-lotus-openness="0.120"')
    expect(renders[1].match(/data-lotus-form="closed-bud"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(renders[2]).toContain('data-seasonal-part="autumn-maple"')
    expect(renders[3]).toContain('data-seasonal-part="winter-ice"')
    expect(renders[3]).toContain('data-seasonal-part="winter-snowfall"')
    expect(renders[3].match(/class="snowfall"/g)?.length).toBeGreaterThanOrEqual(24)
    expect(renders[3]).toContain('data-snow-depth="near"')
    expect(renders[3]).toContain('data-snow-depth="middle"')
    expect(renders[3]).toContain('data-snow-depth="far"')
    expect(renders[3].match(/data-snow-landing="ice"/g)?.length).toBeGreaterThanOrEqual(4)
    expect(renders[3].match(/data-snow-landing="water"/g)?.length).toBeGreaterThanOrEqual(12)
    expect(renders[3]).toContain('data-snow-effect="ice"')
    expect(renders[3]).toContain('data-snow-effect="water"')
    expect(renders[3]).toContain('class="snow-settle"')
    expect(renders[3]).toContain('class="snow-melt"')
    expect(renders[3]).toContain('@keyframes snow-melt{')
    expect(renders[3]).toContain('@keyframes snow-settle{')
    expect(renders[0]).not.toContain('data-seasonal-part="summer-fireflies"')
    expect(renders[0]).not.toContain('data-seasonal-part="winter-snowfall"')
    expect(renders[2]).not.toContain('data-seasonal-part="summer-fireflies"')
    expect(renders[2]).not.toContain('data-seasonal-part="winter-snowfall"')
  })

  it('moves a restrained water-light path with the solar direction', () => {
    const morning = deriveEnvironment(momentFromText('2026-08-16', '06:15'), 'summer')
    const evening = deriveEnvironment(momentFromText('2026-08-16', '18:15'), 'summer')
    const morningSvg = renderSVG(grid, pondPlan, themeForEnvironment(morning), 'seasonal-render', { environment: morning }).svg
    const eveningSvg = renderSVG(grid, pondPlan, themeForEnvironment(evening), 'seasonal-render', { environment: evening }).svg
    const light = (svg: string) => svg.match(/<g data-pond-part="directional-light"[^>]*>.*?<\/g>/)?.[0]

    expect(light(morningSvg)).toBeTruthy()
    expect(light(eveningSvg)).toBeTruthy()
    expect(light(morningSvg)).not.toBe(light(eveningSvg))
  })

  it('reveals moonlight only when an illuminated moon is above the night pond', () => {
    const darkMoon = deriveEnvironment(momentFromText('2026-08-16', '00:00', 0, 0, 0), 'summer')
    const fullMoon = deriveEnvironment(momentFromText('2026-08-28', '00:00', 0, 0, 0), 'summer')
    const darkSvg = renderSVG(grid, pondPlan, themeForEnvironment(darkMoon), 'seasonal-render', { environment: darkMoon }).svg
    const fullSvg = renderSVG(grid, pondPlan, themeForEnvironment(fullMoon), 'seasonal-render', { environment: fullMoon }).svg

    expect(darkSvg).not.toContain('data-pond-part="moon-light"')
    expect(fullSvg).toContain('data-pond-part="moon-light"')
    expect(fullSvg).toContain('class="moon-path moon-path-a"')
    expect(fullSvg).toContain('@keyframes moon-path{')
  })

  it('drives water motion and autumn leaves from the same changing current', () => {
    const eastward = deriveEnvironment(momentFromText('2026-08-16', '12:00', 0, 0, 0), 'autumn')
    const westward = deriveEnvironment(momentFromText('2026-08-22', '12:00', 0, 0, 0), 'autumn')
    const eastSvg = renderSVG(grid, pondPlan, themeForEnvironment(eastward), 'seasonal-render', { environment: eastward }).svg
    const westSvg = renderSVG(grid, pondPlan, themeForEnvironment(westward), 'seasonal-render', { environment: westward }).svg
    const currentRule = (svg: string) => svg.match(/@keyframes current\{[^@]+/)?.[0]
    const firstLeaf = (svg: string) => svg.match(/class="maple" style="([^"]+)/)?.[1] ?? ''
    const variable = (style: string, name: string) => Number(style.match(new RegExp(`--${name}:([-\\d.]+)px`))?.[1])

    expect(eastward.currentDirection).toBeGreaterThan(0)
    expect(westward.currentDirection).toBeLessThan(0)
    expect(currentRule(eastSvg)).not.toBe(currentRule(westSvg))
    expect(variable(firstLeaf(eastSvg), 'mx0')).toBeLessThan(variable(firstLeaf(eastSvg), 'mx3'))
    expect(variable(firstLeaf(westSvg), 'mx0')).toBeGreaterThan(variable(firstLeaf(westSvg), 'mx3'))
  })

  it('floats summer lotus flowers with the water current and calms them at night', () => {
    const eastward = deriveEnvironment(momentFromText('2026-08-16', '12:00', 0, 0, 0), 'summer')
    const westward = deriveEnvironment(momentFromText('2026-08-22', '12:00', 0, 0, 0), 'summer')
    const night = deriveEnvironment(momentFromText('2026-08-16', '00:00', 0, 0, 0), 'summer')
    const eastSvg = renderSVG(grid, pondPlan, themeForEnvironment(eastward), 'seasonal-render', { environment: eastward }).svg
    const westSvg = renderSVG(grid, pondPlan, themeForEnvironment(westward), 'seasonal-render', { environment: westward }).svg
    const nightSvg = renderSVG(grid, pondPlan, themeForEnvironment(night), 'seasonal-render', { environment: night }).svg
    const firstDrift = (svg: string) => svg.match(/class="summer-lotus-drift"[^>]+/)?.[0] ?? ''
    const variable = (attributes: string, name: string) => Number(attributes.match(new RegExp(`--lotus-${name}:([-\\d.]+)px`))?.[1])
    const amplitude = (attributes: string) => Number(attributes.match(/data-lotus-drift-x="([\d.]+)"/)?.[1])

    expect(eastward.currentDirection).toBeGreaterThan(0)
    expect(westward.currentDirection).toBeLessThan(0)
    expect(firstDrift(eastSvg)).toContain('data-lotus-current="1"')
    expect(firstDrift(westSvg)).toContain('data-lotus-current="-1"')
    expect(variable(firstDrift(eastSvg), 'x0')).toBeLessThan(variable(firstDrift(eastSvg), 'x2'))
    expect(variable(firstDrift(westSvg), 'x0')).toBeGreaterThan(variable(firstDrift(westSvg), 'x2'))
    expect(amplitude(firstDrift(eastSvg))).toBeGreaterThan(amplitude(firstDrift(nightSvg)) * 2)
  })

  it('bends spring water plants with the current and dims their bubbles at night', () => {
    const eastward = deriveEnvironment(momentFromText('2026-08-16', '12:00', 0, 0, 0), 'spring')
    const westward = deriveEnvironment(momentFromText('2026-08-22', '12:00', 0, 0, 0), 'spring')
    const night = deriveEnvironment(momentFromText('2026-08-16', '00:00', 0, 0, 0), 'spring')
    const eastSvg = renderSVG(grid, pondPlan, themeForEnvironment(eastward), 'seasonal-render', { environment: eastward }).svg
    const westSvg = renderSVG(grid, pondPlan, themeForEnvironment(westward), 'seasonal-render', { environment: westward }).svg
    const nightSvg = renderSVG(grid, pondPlan, themeForEnvironment(night), 'seasonal-render', { environment: night }).svg
    const firstPlant = (svg: string) => svg.match(/class="spring-plant"[^>]+/)?.[0] ?? ''
    const angle = (attributes: string, name: string) => Number(attributes.match(new RegExp(`--plant-${name}:([-\\d.]+)deg`))?.[1])
    const bubbleOpacity = (svg: string) => Number(svg.match(/data-spring-part="oxygen-bubbles" opacity="([\d.]+)"/)?.[1])
    const bias = (attributes: string) => (angle(attributes, 'r0') + angle(attributes, 'r1')) / 2

    expect(firstPlant(eastSvg)).toContain('data-plant-current="1"')
    expect(firstPlant(westSvg)).toContain('data-plant-current="-1"')
    expect(bias(firstPlant(eastSvg))).toBeGreaterThan(0)
    expect(bias(firstPlant(westSvg))).toBeLessThan(0)
    expect(bubbleOpacity(eastSvg)).toBeGreaterThan(bubbleOpacity(nightSvg))
  })

  it('starts complete fish bodies and keeps the loop seam closed by day and night', () => {
    const environments = [
      deriveEnvironment(momentFromText('2026-08-16', '12:00'), 'summer'),
      deriveEnvironment(momentFromText('2026-08-16', '00:00'), 'summer'),
    ]

    for (const environment of environments) {
      const svg = renderSVG(grid, pondPlan, themeForEnvironment(environment), 'seasonal-render', { environment }).svg
      const bodyDelays = [...svg.matchAll(/class="f\d+" style="[^"]*animation-delay:([\d.-]+)s/g)]
        .map(match => Number(match[1]))
      expect(bodyDelays.length).toBeGreaterThan(20)
      expect(bodyDelays.every(delay => delay < 0)).toBe(true)

      for (const fish of pondPlan.fishes) {
        const start = `translate(${fish.start.x.toFixed(1)}px,${fish.start.y.toFixed(1)}px)`
        expect(svg).toContain(`@keyframes fp${fish.id}{0.00%{transform:${start}`)
        expect(svg).toContain(`100%{transform:${start};opacity:0.92}`)
      }
    }
  })

  it('keeps persistent history out of the original fish drawing language', () => {
    const fish = pondPlan.fishes[0]
    const staticTime = pondPlan.duration * 0.4
    const original = fishSVG({ ...fish, lifetimeEnergy: 0 }, THEMES.dark, staticTime, pondPlan.duration)
    const mature = fishSVG({ ...fish, lifetimeEnergy: 10_000 }, THEMES.dark, staticTime, pondPlan.duration)

    expect(mature).toBe(original)
    expect(mature).not.toContain(`class="a${fish.id}"`)
  })
})
