# CC700 coherent rendering improvements

Implement the research findings without sacrificing street legibility or changing green/grey fills. User has authorized implementation, testing and deployment and opted out of routine approval loops.

Approach: retain cased roads and current source semantics; first remove repeated selection work in the actual C iterator with an automatic legacy fallback. Prepare display geometry once before block clipping, protecting junctions and semantic boundaries. Choose deterministic map-space label candidates and enforce bounded screen collision checks. Fix doubled-hole-edge fill artifacts in device and preview together. Preserve separate installed/candidate profiles. Use existing format and owned buffers, no full raster cache or new live GPS behavior.

Alternatives: negative-space filling remains an experimental comparison because it increases scanline work and lacks universal coverage. Bigger bitmap caches require unknown PSRAM headroom and are not justified. A complete routing matcher is separate from display geometry and must not be implied by this work.

Constraints: one block loaded, 12 labels; 240x256 RGB565 canvas. Maintain old route-file compatibility, layer/bridge/tunnel/rough semantics, fallback on allocation failure and lock balance. Do not consume saved work by indiscriminately adding decoration. No unmeasured FPS claims. Private rides and coordinates stay local. Produce a versioned firmware candidate, validate native C and route-generation output, deploy web only after release checks; device installation only after verified artifact and reachable idle device. Record actual installed state and any blocked target measurements explicitly.
