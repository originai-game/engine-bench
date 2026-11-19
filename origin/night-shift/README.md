# Night Shift (the benchmark's copy)

origin-engine's hero showcase B (`showcase/night-shift` on origin-engine
`main` at 49bac45d1e), built for the benchmark with the released engine
through the og launcher (`project.ogt` pins `engine "0.9.0"`).

Changes from the showcase, and why:

- **No HUD, no font pack.** `src/hud.ts`, `assets/ui/`, `assets/textures/map.png`
  and `assets/fonts/` are gone, with the HUD's wiring in `src/main.ts`. The HUD
  is a UI overlay, not the 3D scene, and on the 0.9.0 web host a game whose
  bundle carries the `fonts/latin` font pack never draws its first frame in
  Chrome (with the HUD, `start` throws that the font "is still being fetched").
- **The camera flies the benchmark's path** (`src/camera-path.ts`, which the
  three.js page imports too) on the simulation's tick, from tick 0.

Everything else (`src/set.ts`, `src/cast.ts`, `src/air.ts`, `src/flora.ts`,
`assets/`, `looks/night-shift.ogt`) is the showcase's. The binary assets are
not in git: `bun scripts/fetch-assets.ts` (from the repository root) installs
them from the OriginGame asset store, each checked against its sha256 in
`og-assets.json`. The models and textures came through the OriginGame gateway
(generated for origin-engine, Meshy and gpt-image) and Poly Haven (CC0); the
showcase's README in origin-engine lists each one's source.
