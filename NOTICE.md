# Koi Almanac lineage and attribution

Koi Almanac is an independently maintained derivative of `0xydev/koipond`, created by 0xydev and
originally published at <https://github.com/0xydev/koipond>. The source baseline used by this project
is commit `f8f22b02d95cdb4905b597fb4d1e766000e4d020`.

The original project established the central concept, visual language, contribution-to-plankton
mapping, koi animation and rendering system, GitHub Action, and browser-based username query.

Qy's Koi Almanac builds on that foundation with:

- persistent fish identity and cumulative ecosystem state;
- replay-safe contribution feeding;
- SHA-256-linked state provenance and standalone verification;
- energy-aware ecology, schooling, separation and obstacle avoidance;
- reduced-motion rendering and GIF/MP4 capture;
- restrained light and dark water-detail refinements;
- a continuous solar, lunar and four-season environment;
- first-party contribution data, release provenance and production monitoring.

This repository begins with a new Qy root history so it can be released and operated independently.
It does not require the original repository at build time or runtime. The original MIT copyright and
permission notice remain in `LICENSE`, and this notice remains part of every Koi Almanac source copy.
No endorsement by the original author is implied.

The `koipond-state-v2` schema, `KOIPOND_*` Action environment variables and `koipond-*` SVG metadata
identifiers are retained as compatibility namespaces so existing state chains remain independently
verifiable across the migration. They do not create an upstream service or repository dependency.
