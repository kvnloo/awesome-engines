# Detail manifest and performance gates (proposal)

Parts have stable symbolic IDs exposed by the renderer, independent of visible meshes. A released CAD asset **must** preserve stable IDs and provenance so Hermes can say `focus(part="crankshaft")` without relying on a fragile screen coordinate.

Suggested manifest per assembly:

```json
{"version":1,"engine":"otto","source":"permalink-to-licensed-cad","unit":"m","coordinateFrame":"Y-up","lods":[{"path":"assembly-lod2.glb","maxErrorPx":12},{"path":"assembly-lod1.glb","maxErrorPx":3}],"parts":{"crankshaft":{"label":"Crankshaft","meshes":["crank-journal","crank-throw"],"bounds":[0,0,0,1,1,1],"lod0":"parts/crankshaft-lod0.glb","maps":{"baseColor":"parts/crankshaft.ktx2"}}}}
```

Do not fetch a 16K/64K image to show a thumbnail. Select by projected texels per pixel, use only visible high-resolution tiles in a deep zoom part-inspection mode, cancel superseded requests, do not decode offscreen tiles. Adopt Quackles's *profile* budgets for image tiers only once supported by measured memory pressure: constrained ~40 MiB decoded / 2 concurrent requests, balanced ~64 MiB / 2, full ~96 MiB / 3. Meshes and GPU texture residency require separately enforced caps. Avoid claims of gigapixel coverage until source assets are available and zoom tests establish fidelity.

Per engine acceptance: all selectable parts appear in a parts list; ray-picking identifies correct stable ID; focus achieves meaningful sub-mm scale for available geometry; explode/restoring returns identical assembly transforms; no stale high-res tiles after switching engine; motion and energy balance verified against reference data; phone tests record p50/p95 frame time and peak decoded/GPU memory.