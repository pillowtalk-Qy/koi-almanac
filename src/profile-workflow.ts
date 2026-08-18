const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'

export const PROFILE_WORKFLOW = `name: koi-almanac
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
        uses: ${CHECKOUT} # v7.0.1
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
          node -e 'const fs=require("node:fs");const manifest=JSON.parse(fs.readFileSync(".koi-release/release.json","utf8"));const sha=manifest.action?.sha;if(manifest.schemaVersion!==1||manifest.action?.repository!=="pillowtalk-Qy/koi-almanac"||!/^[0-9a-f]{40}$/.test(sha??""))throw new Error("Invalid Koi Almanac release manifest");fs.appendFileSync(process.env.GITHUB_OUTPUT,"sha="+sha+"\\n")'
      - name: Check out the exact published generator
        uses: ${CHECKOUT} # v7.0.1
        with:
          repository: pillowtalk-Qy/koi-almanac
          ref: ${'$'}{{ steps.release.outputs.sha }}
          path: .koi-almanac
          persist-credentials: false
      - name: Generate the pond
        uses: ./.koi-almanac
        with:
          github_user_name: ${'$'}{{ github.repository_owner }}
          generator_repository: pillowtalk-Qy/koi-almanac
          generator_sha: ${'$'}{{ steps.release.outputs.sha }}
          outputs: |
            dist/koi-almanac.svg?environment=auto&timezone=480&latitude=22.3193&longitude=114.1694
      - uses: peaceiris/actions-gh-pages@84c30a85c19949d7eee79c4ff27748b70285e453 # v4.1.0
        with:
          github_token: ${'$'}{{ secrets.GITHUB_TOKEN }}
          publish_branch: output
          publish_dir: ./dist
`
