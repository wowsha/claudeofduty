# DEAD DROP – quality cycle log

Screenshots live in `shots/` (rendered headless in Chromium/SwiftShader at 1280×720 via a scripted debug hook, `window.__fps`).
The project built and ran after every cycle.

| # | Weakest area picked | Harsh critique of the screenshots | Change |
|---|---|---|---|
| 0 | Baseline | Whole frame blown out: dense bright fog + HDR sky + bloom = milky white, no contrast, shadows invisible. Holo sight rendered as an opaque milky rectangle. Asphalt normal map like cracked mud, cars covered in orange rust camo. | Built engine: PBR procedural textures, merged-geometry plaza, sun shadows, GTAO, bloom, ACES, SMAA, MSAA, viewmodel pass, enemies, synthesized audio, React HUD. |
| 1 | Lighting / atmosphere | (above) | Exposure 1.0→0.62, fog density halved & darker, sky turbidity/mie reduced (less sun glare), bloom threshold 0.9→1.4, removed sight glass slab, asphalt normals 4→1.6, car rust reduced. Result readable, contrasty, shadows visible. |
| 2 | Wall / ground materials | Facades looked like pink polka-dot wallpaper (brick-damage mask too frequent and tiny); plaster over-bright; fountain bleached; asphalt blue and sparkly. | Rare large exposed-brick patches with darker brick, plaster tile 3→6 m, concrete albedo lowered, asphalt neutral/rougher, stronger contact-shadow blobs. |
| 3 | Viewmodel | Hip pose pushed gun and hands off-screen (reload showed no arms); ADS sight absurdly large (eye relief 0.27 m); gun albedo near black; metal "wear" looked like snow. | Weapon FOV 52→60, new hip & ADS positions (0.40 m relief), brighter gunmetal/polymer, more hemi fill, wear speckle 4× weaker, reload tilt reduced so hands stay in view. |
| 4 | Combat feedback | Muzzle flash/impacts too faint at range; damage tint covered the whole screen. | (diagnosed – see 5) |
| 5 | Impact FX + damage grade | Dust/sparks/decals tiny at 12 m; red damage overlay far too heavy; fountain cracks black. | Larger/denser dust, bigger hot sparks + impact flash, bigger decals, player tracer starts 4.5 m out, edge-only damage tint, subtler cracks, stronger flash + light. |
| 6 | Skyline | Distant towers were blank slabs carrying the same dotted pattern. | Plain concrete/plaster at 12 m tiles + window grids (some lit), floor bands, facing the plaza. |
| 7 | Verification | Suspected tracer artifact (white bar) and invisible flash. | Verified: bar is road paint under the camera in the test pose; flash renders correctly (crop `shots/c7_crop.png`). Tracers hidden for first 6 m of flight, flash additionally depth-test-free. |

## Where it stops (cycle 7)

Still short of a recent CoD:
- **Geometry**: cars, props and buildings are primitive/extruded shapes (no sculpted/scanned meshes, no interiors, no destructible cover). Biggest remaining gap.
- **Textures**: all procedural, tile repetition is visible on large concrete surfaces; no parallax/POM, no decal variety (no blood decals, scorch marks, graffiti).
- **Characters**: enemies are low-poly, vertex-coloured and animated procedurally (no skinned mocap, no hit-reaction variety, no ragdoll physics, one body type).
- **Weapon**: single rifle; hands are capsule/box gloves, no finger animation, no scope/attachment/inspect/weapon-swap animations.
- **Lighting**: single static-resolution shadow cascade (no CSM), no real-time GI/SSR (puddles use env reflections only), no volumetric light shafts, no TAA, no motion blur/DoF.
- **Audio**: synthesized (convincing for shots, thin for footsteps/voices); no VO, no music, no surface-dependent footsteps.
- **AI**: simple goal/strafe/burst behaviour; no cover usage, flanking, grenades.

## Next cycle would target
1. Replace the ad-hoc props with higher-fidelity kit-bashed meshes (cars with proper wheel arches/interiors, rubble, clutter) and add 3-cascade CSM for sharper near shadows.
2. Then hand/arm modelling + finger poses and a weapon-swap/second weapon.
