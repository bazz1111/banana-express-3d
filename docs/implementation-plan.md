# Banana Express Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline. User explicitly instructed immediate implementation of the selected design.

**Goal:** Deliver a playable low-poly downhill delivery game matching concept A.

**Architecture:** Local Blender generates every visible mesh and a track manifest. A typed fixed-step simulation owns cargo, obstacles, skills, timer and delivery. Rapier tracks kinematic bicycle/traffic bodies and owns flying-vehicle dynamics against the Blender road mesh. Three.js loads these models; DOM UI and Web Audio provide feedback.

**Tech Stack:** Vite 8.3.4, TypeScript 7.0.2 (rules/physics; render/UI migration remains), Three.js 0.186.1, Rapier 0.21.0, local Blender 5.2.2.

**Spec:** docs/design.md

## Global Constraints

- Every visible 3D model has local Blender provenance and an editable .blend source.
- Match image A: faceted mountains, red earth, bright yellow bananas, black steel bicycle, red-shirted rider.
- 100 bananas, bundles of 5; minimum delivery 50; deadline 240s; Q cooldown 18s and E cooldown 12s.
- Keyboard controls and complete loading-to-delivery loop; browser-local score storage.

## Review Focus

- Repeated contact must not repeatedly deduct cargo.
- Focus loss and pause cannot advance the timer or release a queued kick.
- Obstacles and skills reset between runs; shared model resources do not leak.
- High-speed motion cannot skip a collision or delivery transition.
- Missing assets or unavailable WebGL/storage produce a useful outcome.

## Task 1: Rules

**Files:** src/game.ts, tests/game.test.js

**Interfaces:** createGame(course), startLoading(game), advance(game, input, delta), resultFor(game). Input booleans load/launch/throttle/brake/jump/kick/brace/deliver plus steer in [-1,1]. State events carry presentation feedback. Course contains length, points, rough zones and authored obstacles.

- [x] Write and run failing behavior tests.
- [x] Implement fixed-step loading, racing, collisions, skills, delivery, pause and scoring.
- [x] Run node --test tests/game.test.js; expect all tests passing.

## Task 2: Blender assets

**Files:** scripts/build-assets.py, scripts/check-assets.mjs, assets/blender/*.blend, public/assets/*.glb, public/assets/course.json, public/assets/manifest.json

**Interfaces:** GLB templates for rider/bicycle/banana/truck/car/pedestrian/goat/vegetation/houses/effects plus a complete road/terrain GLB. Blender road JSON is authoritative for both rules and rendering.

- [x] Build in the local Blender CLI, preserving editable source files.
- [x] Parse and verify every GLB, required templates, source files, and mesh budgets.

## Task 3: Playable view

**Files:** index.html, src/main.js, src/view.js, src/style.css, src/audio.js

**Interfaces:** View.sync(game, delta) consumes simulation state/events; assets are loaded once and reused between runs.

- [x] Create an actual 3D welcome scene and focused loading/racing/delivery/result UI.
- [x] Connect real keyboard controls, camera, pedal/kick/obstacle animation, banana losses, particles and sound.
- [x] Build with Vite; expect successful production output.

## Task 4: Browser verification and delivery

**Files:** scripts/browser-check.mjs, README.md, docs/progress.md

- [x] Run the game in an actual browser; complete the loop with keyboard input.
- [x] Check pause, reset, collision, skill cooldown, model visibility, screenshots, errors and performance.
- [x] Review and fix defects, run the full suite and production build, then open the playable page for the user.

## Task 5: Align the technical foundation with the staged roadmap

**Files:** src/game.ts, src/physics.ts, src/view.js, src/main.js, tests/physics.test.js, tsconfig.json

- [x] Migrate rules and handling configuration to strict TypeScript; preserve existing gameplay defaults.
- [x] Add Rapier kinematic bicycle and traffic bodies, using the local Blender GLB as static collision geometry.
- [x] Switch kicked vehicles to dynamic bodies and apply mass-scaled linear/angular impulses; replace scripted flight in the renderer.
- [x] Verify pause, restart, ground contact, render-rate independence and oncoming-car kick direction with actual Rapier tests.
- [x] Verify the visible heavy truck follows its Rapier body in the real browser and complete delivery.

This is a partial technical migration. Character rigging, exported Actions, sprint, spline/chunk streaming, Toon rendering, LOD/bakes/compression and full visual acceptance remain separate work.

## Task 6: Rebuild the style-A hero and foreground assets

**Files:** scripts/build-assets.py, assets/blender/asset-library.blend, public/assets/cargo.glb, src/view.js, src/reference-scene.js

- [x] Rebuild distinct curved bananas and author all 20 bundle transforms in Blender; render them with one InstancedMesh and preserve cargo counts.
- [x] Refine rider clothes/limbs/hands/shoes and classic bicycle spokes/cables/metal/ropes in Blender.
- [x] Refine red cliffs and slate canvas; stabilize the course's procedural seed.
- [x] Compare real 3D frames with A, verify projected actor composition and clear inspection gestures on restart.
- [x] Validate Blender sources/exports, pose/cargo regression, full browser delivery and current production build.

This improves the foreground; it does not complete the high-fidelity objective. Next art work must address valley density, readable lake/shore layering, mountain silhouettes, truck details and authored character animation.

## Task 7: Reconstruct the valley and distant landscape

**Baseline:** assets/reference/style-a.png, unchanged foreground/UI and gameplay.
**Assets:** local Blender village/forest templates, VillageHillside/ValleyLake meshes and course decor; unit meters, GLB Y-up, vertex palettes. Existing manifest remains the asset inventory.

- [x] Inspect camera projections and actual lake occlusion before changing terrain.
- [x] Model distinct local house/forest variants and export editable Blender sources plus GLBs.
- [x] Arrange denser woods and a coherent lakeside village on matching ground heights; open the lake sightline and separate ridge layers.
- [x] Render the new variants through Three.js instancing, preserving route chunks and budgets.
- [x] Compare the same real 3D frame to A; validate exports, ground attachment, full delivery and current build. Record performance as a machine-specific sample.

File/engine verification and whole-image visual acceptance are separate gates. Work continues under the existing implementation authorization.

## Task 8: Refine the truck and kick flash against style A

**Baseline:** assets/reference/style-a.png, same inspection camera and kicked-vehicle pose.
**Scope:** truck and kick-flash mesh/material detail; keep the HUD, route, controls, skill timing and delivery rules. Preserve the low-poly olive body, cream cab/tailgate and dark slate canvas. Shrink the flash's excessive horizontal spread and match A's warmer yellow.
**Production:** local Blender bpy → asset-library.blend, truck.glb and burst.glb; meters, GLB Y-up, shared palettes. Add folded rear curtains, canvas seams/ties, dual rear tires with tread/hubs, and readable underside/cab hardware. Author the flash silhouette as a Blender mesh. Keep the existing collision body and verify imported scale/materials.

**Runtime correction:** same-pose comparison exposed speckled vehicle shadows from the existing negative depth bias. Set the sun depth bias to zero; retain normal offset and check road/wheel contact shadows in the actual game.

- [x] Inspect the existing render against A and record the main truck/flash differences.
- [ ] Rebuild the local Blender truck and export editable source plus GLB.
- [ ] Compare the same actual Three.js frame and inspect the model from multiple sides.
- [ ] Verify source/export integrity, existing gameplay/physics tests, production build, delivery flow and draw-call budget.

Model/engine checks do not certify the whole frame or future character/landscape fidelity.

## Task 9: Improve the rider, bicycle contact and bananas

**Priority:** latest human request emphasizes the main cyclist and bananas. Continue using A, its red shirt/blue pants/dark skin/short curls, classic bicycle and 100-banana load.
**Sources:** local Blender rider, bicycle, banana/looseBanana and cargo factories; editable asset-library.blend plus current GLBs. Preserve hip/knee anchors and twenty five-fruit bundle IDs.
**Changes:** tailored cloth folds, shaped limbs, face/curls, hands gripping the bar and sneakers; fuller curved fruit with peel ridges and a connected crown, varied cargo poses. Add separate foot/pedal nodes and a two-bone riding pose so shoes follow the pedals while remaining level. Preserve the existing kick target, rules, cooldowns, route and HUD.

- [ ] Model and export the revised rider/bike/banana/cargo in local Blender.
- [ ] Test pedal contact and full-kick/restoration; connect Three.js joint poses.
- [ ] Inspect front/rear portraits, banana close-up and the same full game frame.
- [ ] Verify asset exports, current build, complete delivery and draw-call budget.

Object joints are retained for this pass; Rigify, exported Actions and full style-A visual acceptance remain pending.
