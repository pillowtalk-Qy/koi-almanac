# Koi Almanac 🎏

[![ci](https://github.com/pillowtalk-Qy/koi-almanac/actions/workflows/ci.yml/badge.svg)](https://github.com/pillowtalk-Qy/koi-almanac/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/pillowtalk-Qy/koi-almanac)](https://github.com/pillowtalk-Qy/koi-almanac/releases/latest)
[![upstream](https://img.shields.io/badge/upstream-0xydev%2Fkoipond-2f81f7?logo=github)](https://github.com/0xydev/koipond)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

> [!IMPORTANT]
> **Project lineage:** Koi Almanac is an independently published and operated Qy project derived
> from `0xydev/koipond`. The original concept, visual language, renderer and initial implementation
> were created by 0xydev. This repository begins with a new Qy root history and contains everything
> required to build, verify and operate the project without an upstream runtime dependency. The
> original MIT copyright and permission notice are preserved in [`LICENSE`](LICENSE), and the exact
> source baseline and modification scope are recorded in [`NOTICE.md`](NOTICE.md).

Turn your GitHub contribution graph into a living koi pond, seen from above.

**The pond below is a 24-second accelerated tour of the living year. To see your own Koi Almanac
generated from your real GitHub contribution history, current date, time and season, use the
[live explorer](https://pillowtalk-qy.github.io/koi-almanac/).**

The original edition remains available at
[0xydev.github.io/koipond](https://0xydev.github.io/koipond/).

<img width="100%" alt="A native animated contribution pond moving through four seasons and day and night" src="assets/demo-almanac.svg">

Your contributions become plankton: bigger and brighter the more you commit. Fish paths come from
a deterministic steering-force simulation (momentum, capped turning force, a gentle wander), and
each body is drawn as the fish's own trail: a dense run of translucent circles replaying the head's
path a beat later, with a grow-then-taper size profile and alpha fading toward the tail. In a turn
the body wraps the curve, because the body *is* the curve. Fish graze the year clean; when the pond
empties, night falls and the ecosystem regrows in a seamless loop. Every bite sends a ripple across
the water.

The graph does not just feed the fish, it shapes the ecosystem:

- **Fish count, species and size** respond to active days, contribution energy and consistency.
- **Contribution levels carry energy**: richer plankton changes target choice, swimming pace and satiety.
- **Fish persist between days**: identity, markings and earned growth survive each nightly refresh.
- **Koi and minnows behave differently**: koi favor high-energy food while minnows favor dense grazing areas.
- **The pond has physical relationships**: fish separate from one another, minnows school and all fish avoid lily pads.
- **A 30+ day streak** earns a pond turtle paddling across. 🐢
- **A 21+ day quiet stretch** makes a lotus bloom over its center. 🪷
- **Dark mode is bioluminescent**: an abyssal pond, twinkling plankton, glowing spirit koi.
- **The original light and dark ponds form one 24-hour cycle**: the sun's height and direction move
  the original rays, caustics, surface sheen and shadows through dawn, daylight, dusk and night.
  Each season keeps its own night ecology instead of collapsing into one shared dark palette.
- **Night changes with the moon as well as the season**: a deterministic lunar cycle alters the
  water color and leaves restrained, broken moonlight on the surface only while an illuminated moon
  is above the pond. No weather or astronomy API is required.
- **One current moves the whole surface**: its direction and strength change continuously, then
  propagate through broad water bands, caustics, floor-shadow drift, motes, lily-pad sway and autumn
  leaves instead of giving each layer an unrelated animation.
- **The year moves continuously through four physical ecologies**: spring keeps the original pond,
  summer fills its lily pads with day- and night-blooming flowers while fireflies visit individual
  lotus flowers and leave a synchronized glint,
  and individual maple leaves cross the autumn surface
  with their own drift, rotation and wake. Winter ice and snow become real obstacles that fish route
  around; a streak turtle slows at the edge, climbs onto the ice, leaves tracks step by step and
  splashes back into the water instead of passing beneath it; winter snow settles briefly on those
  same ice shapes but melts into a ripple when it lands on open water.

Koi Almanac deliberately keeps the original composition and art direction. Its changes
are behavioral: the same contribution graph now produces a more causal ecosystem instead of adding
new panels, labels or decorative species. Viewers who prefer reduced motion receive a complete still
pond with the fish placed along their real paths.

The published `pond-state.json` is intentionally small and auditable. It contains the public daily
contribution levels, deterministic fish identities and cumulative feeding energy. It never stores
contribution repository names, commit messages, private counts or visitor data. A repeated run over the same
calendar cannot feed the fish twice; only newly visible energy changes the state. Every revision
contains SHA-256 digests of its source calendar, complete state and preceding revision. New revisions
also bind the generator repository and exact 40-character commit SHA into that digest. The same
provenance is embedded in the SVG's `<metadata>` element.

The online explorer reads only GitHub's public contribution calendar through this project's own
Cloudflare Worker, rather than a third-party contribution API. The Worker sets no cookies, emits no
application logs and stores no visitor identifiers. It keeps a 15-minute fresh edge cache of the public
calendar plus a seven-day last-successful snapshot in Cloudflare's global KV, keyed only by the requested
public GitHub login and used only when GitHub is temporarily unavailable. The snapshot contains no IP,
cookie or visitor identity; stale responses identify their edge or global source in HTTP headers and the
explorer UI. Its source and runtime tests live
in [`worker/`](worker/), and the production health
endpoint is [`koi-almanac-contributions.intentflow-inspector.workers.dev/health`](https://koi-almanac-contributions.intentflow-inspector.workers.dev/health).

A daily first-party synthetic monitor checks the explorer, local verifier, Worker, one fixed public
calendar, Profile SVG, state hash chain, SVG provenance and released generator SHA. A real Chromium
pass also opens the production explorer and verifier at desktop and mobile sizes, including reduced
motion, layout overflow and edge-cache checks. It never samples real visitors, sends no application
cookies and retains no response bodies. The endpoints and synthetic identity are explicit in
[`monitor.json`](monitor.json); the monitor runs in GitHub Actions and can also be run with
`npm run monitor:production`.

Everything is baked into a self-contained animated SVG (CSS keyframes, no JavaScript), so it works
anywhere GitHub renders images, including profile READMEs. Because GitHub does not execute JavaScript
inside README images, the Action refreshes the solar-time snapshot every hour; the animation itself
continues locally inside that snapshot.

## Usage (GitHub Action)

Five minutes, four steps, no local setup:

1. Create your profile repository if you do not have one yet: a public repo named exactly after
   your username (for example `octocat/octocat`). Its README is what visitors see on your profile.
2. In that repo, create the file `.github/workflows/koi-almanac.yml` with the workflow below (GitHub
   web UI: Add file, Create new file, paste, commit).
3. Go to the Actions tab, pick `koi-almanac`, press `Run workflow` once. This generates the first SVG
   on an `output` branch. After that it refreshes itself every hour.
4. Paste the `<img>` snippet below into your README, replacing `<user>/<repo>`.

```yaml
name: koi-almanac
on:
  schedule:
    - cron: "17 * * * *"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - name: Read the published Koi Almanac release
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          repository: pillowtalk-Qy/koi-almanac
          ref: main
          path: .koi-release
          sparse-checkout: release.json
          sparse-checkout-cone-mode: false
          persist-credentials: false
      - id: release
        name: Validate the published generator
        shell: bash
        run: >-
          node -e 'const fs=require("node:fs");const manifest=JSON.parse(fs.readFileSync(".koi-release/release.json","utf8"));const sha=manifest.action?.sha;if(manifest.schemaVersion!==1||manifest.action?.repository!=="pillowtalk-Qy/koi-almanac"||!/^[0-9a-f]{40}$/.test(sha??""))throw new Error("Invalid Koi Almanac release manifest");fs.appendFileSync(process.env.GITHUB_OUTPUT,"sha="+sha+"\n")'
      - name: Check out the exact published generator
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          repository: pillowtalk-Qy/koi-almanac
          ref: ${{ steps.release.outputs.sha }}
          path: .koi-almanac
          persist-credentials: false
      - name: Generate the pond
        uses: ./.koi-almanac
        with:
          github_user_name: ${{ github.repository_owner }}
          generator_repository: pillowtalk-Qy/koi-almanac
          generator_sha: ${{ steps.release.outputs.sha }}
          outputs: |
            dist/koi-almanac.svg?environment=auto&timezone=480&latitude=22.3193&longitude=114.1694
      - uses: peaceiris/actions-gh-pages@84c30a85c19949d7eee79c4ff27748b70285e453 # v4.1.0
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_branch: output
          publish_dir: ./dist
```

Then embed the generated pond in your README:

```html
<a href="https://pillowtalk-qy.github.io/koi-almanac/?user=<user>">
  <img alt="Koi Almanac" src="https://raw.githubusercontent.com/<user>/<repo>/output/koi-almanac.svg">
</a>
<br>
<sub>This pond follows Hong Kong time and season. Contributions feed it; its fish remember. · <a href="https://pillowtalk-qy.github.io/koi-almanac/verify.html?user=<user>">verify locally</a></sub>
```

Each `outputs` line accepts options as a query string, and can be a `.svg`, `.gif` or `.mp4`:

```yaml
outputs: |
  dist/koi-almanac.svg?environment=auto&timezone=480&latitude=22.3193&longitude=114.1694
  dist/koi-almanac-light.svg
  dist/koi-almanac-dark.svg?theme=dark
  dist/koi-almanac.gif?theme=dark&fps=10&start=10&dur=8
```

| Option | Meaning |
| --- | --- |
| `theme` | `light` (default) or `dark` |
| `seed` | Any string, changes fish variety and routes (defaults to the username) |
| `environment` | Set to `auto` to derive a continuous solar-time and seasonal pond |
| `timezone` | UTC offset in minutes for the automatic pond (`480` is Hong Kong) |
| `latitude` | Latitude used to calculate daylight (`22.3193` is Hong Kong) |
| `longitude` | Longitude used to calculate true solar time (`114.1694` is Hong Kong) |
| `date` | Optional reproducible date override in `YYYY-MM-DD` form |
| `time` | Optional reproducible local-time override in `HH:MM` form |
| `season` | Optional visual test override: `spring`, `summer`, `autumn` or `winter` |
| `fps` | Video frame rate up to 60 (gif and mp4 only, default 10 for gif, 30 for mp4) |
| `start` | Capture start time in seconds into the loop (default 0) |
| `dur` | Capture length in seconds (default: the full loop) |
| `scale` | Resolution multiplier (default 1 for gif, 2 for mp4) |

The Action also writes `dist/pond-state.json`. Because the workflow publishes the complete `dist`
directory to `output`, the next hourly run restores it automatically. The optional Action inputs
`state_file`, `state_branch` and `state_path` change those locations.

The `verify locally` link opens a browser-only verifier. It retrieves the public state, animated SVG
and release manifest directly from GitHub, recomputes both SHA-256 digests, and checks that SVG
provenance and the exact generator commit agree. No state file is uploaded to a verification service.
The current artifact records its previous digest; because older state files are not published, the UI
labels that link as recorded rather than claiming the complete history was re-verified.

The workflow reads the published version from `release.json`, validates it, then checks out and executes
that exact 40-character commit SHA. It follows future Koi Almanac releases automatically without running
mutable `main` branch code; the generated proof records the exact generator commit.
To use the original edition instead, follow the setup guide in
[0xydev/koipond](https://github.com/0xydev/koipond#usage-github-action).

GIF and MP4 outputs use a headless Chromium browser and ffmpeg. Both are preinstalled on GitHub
runners, so they just work in the Action. Locally you need Chrome or Edge plus ffmpeg on PATH.

## Quick start

```sh
git clone https://github.com/pillowtalk-Qy/koi-almanac.git
cd koi-almanac
npm install
npm run demo          # generates dist/koi-almanac-{light,dark}.svg + dist/preview.html
```

Open `dist/preview.html` in a browser to watch both themes.

Generate your own pond (no token needed, works with any public profile):

```sh
npx tsx src/cli.ts --user <your-github-login>
```

With a token you get exact contribution counts instead of levels:

```sh
npx tsx src/cli.ts --user <login> --token <token>
```

Preserve fish identity and growth across local runs:

```sh
npx tsx src/cli.ts --user <login> --state dist/pond-state.json
```

Generate the same automatic Hong Kong environment used by the profile workflow:

```sh
npx tsx src/cli.ts --user <login> --environment --timezone-offset 480 --latitude 22.3193 --longitude 114.1694
```

Verify a downloaded state independently:

```sh
npm run verify:state -- dist/pond-state.json
```

Require the state to have been produced by one exact, independently inspectable generator revision:

```sh
npm run verify:state -- dist/pond-state.json --expect-generator=pillowtalk-Qy/koi-almanac@<40-character-sha>
```

To verify one revision links to an earlier state retrieved from Git history:

```sh
npm run verify:state -- pond-state.json previous-pond-state.json
```

| Flag | Meaning |
| --- | --- |
| `--user` | GitHub login to fetch the contribution calendar for |
| `--token` | GitHub token, falls back to `GITHUB_TOKEN` env (optional) |
| `--demo` | Use generated demo data instead of the API |
| `--seed` | Override the PRNG seed (defaults to the username) |
| `--theme` | `light`, `dark` or `both` (default `both`) |
| `--environment` | Generate one solar-time and season-aware `koi-almanac-auto.svg` |
| `--date`, `--time` | Optional fixed environment moment for previews or reproducible builds |
| `--timezone-offset` | UTC offset in minutes (default `480`, Hong Kong) |
| `--latitude` | Latitude used for solar altitude (default `22.3193`) |
| `--longitude` | Longitude used for true solar time (default `114.1694`) |
| `--season` | Optional season override for visual testing |
| `--out` | Output directory (default `dist`) |
| `--video` | Also render a `.gif` or `.mp4` of the loop, with the same query options (`pond.mp4?fps=60`) |
| `--state` | Read and update a persistent pond-state JSON file (optional) |
| `--generator-repository` | Generator identity to bind into state, as `owner/repository` (requires `--generator-sha`) |
| `--generator-sha` | Exact 40-character generator commit to bind into state |

## How it works

1. **Data**: GitHub GraphQL `contributionCalendar`, the public contributions page (no token), the
   first-party Worker used by the online explorer, or a deterministic demo generator.
2. **State** (`src/state.ts`): compares the public calendar with the previous published snapshot,
   preserves fish identity and credits only new energy. Canonical JSON and SHA-256 bind the source
   calendar, complete state and previous revision into an independently verifiable chain.
3. **Ecology** (`src/ecology.ts`): contribution levels become conserved energy, activity patterns
   become stable ecosystem traits, and lily-pad and winter-ice geometry are shared by rendering
   and path planning.
4. **Environment** (`src/environment.ts`): calculates solar altitude from date, local time,
   latitude, longitude and the equation of time; approximates lunar illumination and its visible
   passage without an external service; derives one continuous current vector; drives directional
   rays, caustics, shadows and surface activity while blending the original light/dark palettes;
   and derives narrow, overlapping seasonal weights for blooms, maple drift, ice coverage and
   winter stillness.
5. **Planner** (`src/planner.ts`): a seeded steering-physics simulation. Fish accelerate under a
   capped force toward their next plankton, change pace with satiety, separate, school, avoid pond
   obstacles and bounce softly off the walls. Deterministic, so the same grid + seed always bakes
   the same film.
6. **Renderer** (`src/render/svg.ts`): bakes the simulated paths into CSS `@keyframes` (decimated on
   straightaways), draws bodies as delayed trails, and quantizes eat times into 0.5% buckets so
   hundreds of plankton share ~100 keyframe blocks, keeping file size down.

## Roadmap

- [x] Steering-physics fish over the contribution field, light and dark themes
- [x] Energy, satiety, schooling, separation and lily-pad avoidance
- [x] Accessible static pond for reduced-motion visitors
- [x] Cross-day fish identity, growth and replay-safe feeding state
- [x] SHA-256 state provenance, exact generator identity, SVG metadata and standalone verification
- [x] GitHub Action packaging with persistent state and query-string options
- [x] GIF and MP4 output (headless browser capture)
- [x] Continuous 24-hour solar direction, light, dawn, dusk and night from the original two palettes
- [x] Deterministic lunar illumination and a shared, continuously changing surface current
- [x] Four-season ecology with summer blooms, autumn maple drift and interactive winter ice
- [ ] More species, decor unlocked by achievements, GitLab support

## Contributing

Contributions are welcome! Feel free to open an issue for bugs and ideas, or send a PR directly.
To get started:

```sh
npm install
npm run demo          # see your changes in dist/preview.html
npm run typecheck
npm test
npm run verify:motion # physics, spacing and loop-seam checks
npm run verify:key-moments # browser checks for firefly, snow, turtle and fish animation events
npm run visual:check  # 32 season/phase/profile/viewport baselines
```

After an intentional visual change, inspect the rendered images in `.visual-regression/`, then run
`npm run visual:update` to accept new baselines. Do not update baselines merely to make CI pass.

Published Action versions have one source of truth: [`release.json`](release.json). Profile workflows
resolve that manifest automatically, so after a candidate commit passes CI only the manifest advances:

```sh
npm run release:sync -- --set=<verified-40-character-sha>
npm run release:check
```

Commit the updated manifest as a small follow-up release commit. CI checks its format and verifies that
the published SHA is an ancestor of the release commit; the production monitor checks that the Profile
workflow still resolves and executes that SHA.

To prepare an emergency rollback to the previous published generator:

```sh
npm run release:rollback
npm run release:check
```

The rollback command refuses to overwrite an already modified `release.json`, selects the previous
distinct SHA from its Git history and verifies that commit is an ancestor of `HEAD`. Review the single
manifest change, commit it and push; Profile workflows follow it automatically. An explicit historical
target can be selected with `npm run release:rollback -- --to=<40-character-sha>`.

New species, decor, themes and achievement rules are all good first issues: species live in
`src/render/fish.ts`, decor in `src/render/decor.ts`, colors in `src/render/palette.ts`.

## License

Koi Almanac is available under the [MIT License](LICENSE). The original 0xydev copyright and permission
notice are preserved together with Qy's copyright. See [NOTICE.md](NOTICE.md) for the source baseline,
project lineage and modification scope.
