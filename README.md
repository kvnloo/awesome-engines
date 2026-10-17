# Engine Atlas · awesome-engines

A part-addressable 3D atlas of power and propulsion, from Hero of Alexandria's aeolipile (1st century CE) to the FIA 2026 Formula One hybrid power unit.

**Status:** working educational prototype, **not** a validated engineering twin. The first wave contains ~23 source-linked historical milestones, procedural assemblies representing seven major engine layouts, slider-crank kinematics, idealized cycle estimates, cutaway/exploded views, part selection, close-focus orbit/zoom, and a Hermes panel.

## Run

Node 20+ and Python 3:

```bash
npm run dev
# http://localhost:4173
npm test
npm run check
```

The viewer imports pinned Three.js from jsDelivr using an import map. An internet connection is required. It can be served as ordinary static files; no server-side API keys.

## Hermes bridge

The app is an **extension frontend**, not a Hermes fork. It speaks the same `/acp` JSON-RPC WebSocket endpoint and `fframestudio.<token>` subprotocol as the local [FFrameStudio bridge](https://github.com/kvnloo/fframestudio/blob/main/bridge/bridge.mjs). Start FFrameStudio bridge normally, then enter the `http://127.0.0.1:7878` endpoint and its token under **Ask Hermes**. The bridge must explicitly allow this web app's origin (`--allow-origin`); do not expose the bridge on public interfaces. Tokens remain only in JS memory; filesystem requests and permissions are denied. Local Hermes availability/login and browser private-network permissions must still be configured. **Bridge integration is coded, not yet integration-tested against a running authenticated Hermes agent.**

## What is / isn't physically accurate

- **Mechanical:** slider-crank geometry constrained by the crank radius and rod length; piston travel follows an exact planar slider-crank relation. Other linkages are illustrative.
- **Thermodynamics:** idealized gas pressure/temperature trends and indicative cyclic phases only — not an engine-specific measured pressure trace, CFD, FEA, chemistry, or actual engine output.
- **2026 F1:** based on public FIA architecture: 1.6 L V6, turbo, 350 kW MGU-K rated electrical system and no MGU-H. Max deployment varies by operating conditions (the April 2026 rules refinements limit deployment to 250 kW in some portions of the lap). The demo has **no team-proprietary internal CAD, software maps, or measured lap curves**. See the [FIA 2026 refinements](https://www.fia.com/news/refinements-2026-fia-formula-1-regulations-agreed-all-stakeholders).
- **Historical:** dates correspond to landmark designs rather than an exhaustive claim of first invention. Hero's aeolipile is a demonstrator; Savery's 1698 pump and Newcomen's 1712 beam engine mark important practical uses.

## High-fidelity / gigapixel architecture — adopting Quackles *performance strategy only*

The interface is unrelated to Quackles. We carry forward the tested approach from [Quackles](https://github.com/kvnloo/quackles): bounded in-flight requests, device-tier budgets, progressive detail, retention of a complete low-detail asset while zooming, cancellation of stale detail, and explicit real-device evidence. **No actual gigapixel source image or manufacturer CAD mesh is included yet.** The procedural geometry is only the fallback.

Next asset format: `models/<engine>/assembly-lod2.glb` (instant), `assembly-lod1.glb` (normal), per-part `lod0.glb` with stable CAD identifiers, plus KTX2 material maps and optional 256/512px tiled photographic microscopic reference with tile manifest. Load when screen-space projected error justifies it. CPU/GPU memory budgets should be per device profile, not an unbounded asset cache.

**Acceptance bar for calling something a digital twin:** traceable source dimensions and coordinate frames; faithful topology/articulation; measured input boundary conditions; deterministic repeat and replay; validated numerical solver results against reference curves; uncertainty notes. Until then, models must remain labeled as reconstructions.

## Next waves

1. Add historical design-specific geometry for Savery, Newcomen, Watt, Stirling, Otto, Diesel, Wankel, turbines and EV powertrains; link primary-source CAD/diagrams with documented licenses.
2. Implement multi-resolution mesh and tile manifests, worker-based decoding, disposal, bounding-volume raycasting, device memory budgets, frame-time instrumentation and benchmark/repro fixtures on actual Galaxy S25 Ultra / desktop GPU.
3. Create physically validated per-family solvers (CoolProp / OpenModelica / Cantera for fluids and chemistry, engine kinematics constraints, electrical dq motor model, torque and energy balance), then compare against documented experiments.
4. Build official-2026 F1 regulation-level ERS strategy simulation with up-to-date rule conditions. Do **not** imply access to team-private maps.
5. Expand the museum into cross-linked engineering chains (rotary → Wankel; steam turbines → marine and electric generation; Otto and Diesel → hybrids and hydrogen), with provenance/versioning per asset.

## Credit and licensing

Historical sources are linked individually in `catalog.mjs`; their images/models are not copied into this repository. Quackles informed asset streaming performance strategy, not the appearance of this app. FFrameStudio provides the bridge architecture. Code in this repository follows its [GPL-3.0 license](LICENSE).