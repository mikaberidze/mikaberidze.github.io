# Schrödinger performance investigation

Investigated November 14, 2026. The original CPU audit is retained below the migration update. The application now selects WebGL2 automatically, with a CPU fallback.

## Implemented GPU migration

`quantum-gpu.js` moves the nine-point solver (both integrators, real/imaginary time), absorbing boundaries, all nine wavefunction color schemes, energy/norm/max reductions, rescaling, eigenstate projection and convergence checking to WebGL2. Persistent 32-bit float targets preserve the existing lattice method and precision class. This migration does not change the underlying four-iteration approximation or its numerical limitations.

The GPU owns the evolving wavefunction. Full fields are synchronized for export, pause, discovered eigenstate storage, and approximately once per second for recovery; ordinary steps/draws do not download the field. Potential edits mark the GPU texture dirty. Reset/import/select-eigenstate operations mark CPU state for upload. The original Canvas2D output and combined recording/PiP canvas remain in place, with the GPU-rendered surface copied by drawImage rather than readPixels. Unchanged potential colorbar ranges are cached.

If WebGL2 or float render targets are unavailable, the existing CPU implementation runs automatically. Append `?compute=cpu` to force it for comparison. On context loss, CPU evolution resumes from the most recent checkpoint, with a visible notice; this can rewind approximately one second of active computation. GPU initialization, rendering, allocation and shader failures also select the CPU path. A failure after a completed solver step does not advance time twice.

### Completion-driven playback

Playback has no target rate and no mapping between wall-clock time and simulation time. The elapsed-time accumulator, reference-width scaling, catch-up limits and playback requestAnimationFrame loop have been removed. Each MessageChannel task takes STEPS_PER_FRAME integration steps (default one), draws the result, handles recording, then queues the next update. Task boundaries let the browser process input and painting; they do not wait for a desired simulated timestamp or display refresh.

A one-pixel GPU readback at the end of each update fences completed work so disabling the energy overlay cannot build an unbounded GPU command backlog. This is computation backpressure, not an artificial time delay. The CPU fallback also runs without a playback-rate cap. Pause stops queuing work, and resume/import/eigensearch restoration restart it as appropriate. Hidden tabs suspend playback; visibility resumes it.

Users can reduce dt to advance less simulation time per update. Actual simulation-time throughput depends on dt, hardware, resolution, browser presentation, and enabled features. The screen can only present updates at its physical refresh rate, even though computation no longer waits for that refresh.

The one-step benchmark below predates the completion-driven playback change and fences GPU work once per measurement batch. It is a component comparison, not a measurement of the new full playback loop, which also fences each completed update.

### Momentum controls after resolution changes

A full UI test reproduced another source of slow motion: the hidden momentum sliders kept their old raw μ values and min/max bounds when grid width changed. Since μ is interpreted relative to the grid's pixels-per-world-unit scale, increasing width fourfold reduced the accessible lattice wavenumber fourfold. Sliders now update their bounds and raw values together, preserving displayed momentum. The regression test checks 400→1600 resizing and reaching p=(0.8,0.6) on the large grid. The previous 1000-step and packet-centroid tests did not exercise these actual HTML slider bounds.

Console diagnostics report actual grid size, backend, solver steps/second, and selected momentum; there is no target rate. The former `frames` counter counted solver steps, not browser frames.

The UI's momentum p is a lattice dispersion parameter, with k=2 asin(p/2). For an axis-aligned plane wave the actual nine-point stencil has E=1−cos(k), and group velocity sin(k)=p sqrt(1−p²/4) cells per simulation-time unit. At p=1 the velocity is approximately 0.866; the maximum of 1 occurs at p=√2. Increasing the limit further is not a general speedup and ultimately reduces group velocity near the lattice cutoff.

The [linked hydrogen demo source](https://github.com/ConQuEr-Erlangen/schrodinger-playground/blob/main/hydrogen-3d.html) precomputes up to four analytic hydrogen orbitals, evolves their coefficients with exp(−iEt), provides a time-speed control and rotates the camera by default. It does not perform an arbitrary-potential grid solve each frame. Its atomic-unit convention also sets ħ=1; changing ħ is not necessary to choose a faster playback clock.

### Browser results after migration

Headless Chrome, ANGLE Metal, Apple M2 Pro. Default CN, dt=0.5, open boundaries, no optional rescaling, the same synthetic Gaussian/step potential and phase colors on each backend. Eight warmup calls, three batches of twenty calls; medians of batch means. The frame workload is one solver step, energy computation and wavefunction drawing on a real Canvas2D, excluding overlay text, potential artwork repainting, DOM, native window compositing and video encoding. Full-field checkpoint copies may occur at the normal interval. A scalar GPU readback and a Canvas2D pixel readback fence each batch: these numbers measure completed work rather than just command submission. Benchmark timings vary by load and hardware.

| Grid | CPU solver | GPU solver | CPU step + draw + energy | GPU step + draw + energy | Frame workload speedup |
| --- | ---: | ---: | ---: | ---: | ---: |
| 400×300 | 7.96 ms | 0.30 ms | 15.23 ms | 1.35 ms | 11.3× |
| 800×600 | 31.28 ms | 0.57 ms | 55.22 ms | 1.82 ms | 30.3× |
| 1600×1200 | 126.44 ms | 2.65 ms | 211.42 ms | 4.72 ms | 44.8× |

At 1600×1200, the GPU handles sixteen times the original pixel count in about one-third the measured time of the 400×300 CPU frame workload. These are not guaranteed native frame rates or mobile/Safari results. Device-specific testing remains necessary.

### Verification and reproduction

Use Node 22+ and an installed Chrome/Chromium:

```sh
node schrodinger/tools/run-browser-tests.cjs
node schrodinger/tools/run-browser-tests.cjs --benchmark
```

The runner starts a temporary loopback server and isolated headless browser profile, collects asynchronous test results, then closes both. Set `CHROME_BIN` if Chrome is installed at another path. No npm dependencies are required. The `.html` pages in `tools/` can also be opened through an HTTP server individually; the benchmark must run with a real clock, without browser virtual-time flags.

All 68 regression checks passed in installed Chrome. Coverage includes all 24 combinations of integrator, time mode, boundary mode and rescaling; 1000-step evolution; odd/non-square grids; mismatched potential dimensions; energy/max/projection/delta reductions; potential edits and cached ranges; every color scheme with output orientation/transparency; no per-step full-field reads; reset/resize; play/pause; undo/redo; evolved-state export/import; full eigensearch and cancellation; selecting eigenstates; combined capture and actual MediaRecorder encoding; unsupported GPU, forced CPU, injected late failure, and forced GPU context loss. Maximum observed component error across the 24 solver combinations was 8.35e-7; the seeded two-state eigensearch differed by at most 2.99e-7. These compare against the original CPU method, not an exact continuum solution.

Native PiP/fullscreen presentation and Safari/mobile interaction were not exercised in this headless environment. The existing PiP/fullscreen handlers were retained, and their shared capture/render pipeline was tested. The in-app visible preview host was unavailable; numerical and integration tests ran in installed Chrome.

## Original CPU audit

The remaining sections describe the pre-migration implementation and its measured baseline. They are retained as the rationale and possible follow-up work.

## Assessment

An order-of-magnitude improvement in computation throughput is a credible GPU migration target, particularly at large grids, but it has not been demonstrated by this investigation. A sharp, high-resolution background/display is achievable independently of a higher-resolution wavefunction grid. Increasing both simulation dimensions by four multiplies grid work by sixteen; achieving ten times the throughput at that larger grid would require roughly 160 times the original per-cell throughput. Separate those requirements before setting targets.

The biggest opportunity is architectural: the application currently does the stencil solver, color conversion, and energy calculation in main-thread JavaScript. The linked fluid simulation runs its field operations and rendering on the GPU. Small JavaScript optimizations alone are unlikely to deliver the requested combined improvement.

## Measured baseline

Run from the repository root:

```sh
node schrodinger/tools/benchmark.cjs
```

Apple M2 Pro, Node v22.13.1, default dt=0.5, four CN fixed-point iterations, open boundaries, synthetic Gaussian with lattice phase and a step potential. Fifteen warmup calls followed by seven batches of five calls; values are medians of batch means. Each component is timed separately. Default phase color scheme. Simulation evolves during warmup and measurement.

| Grid | Solver / step | Color conversion + image buffer / draw | Energy / call | Potential range / call |
| --- | ---: | ---: | ---: | ---: |
| 400×300 | 7.036 ms | 5.469 ms | 0.734 ms | 0.252 ms |
| 800×600 | 28.471 ms | 22.923 ms | 2.775 ms | 1.012 ms |
| 1600×1200 | 114.552 ms | 73.193 ms | 11.233 ms | 2.212 ms |

These are CPU microbenchmarks, **not browser frame rates**. The harness uses a mock Canvas2D context that allocates the actual output byte buffer but does not paint it. It excludes browser compositing, overlay drawing, recording, PiP, DOM, GPU execution and upload. Safari/Chrome JIT behavior may differ. The energy and range columns represent work enabled by default in the real app but disabled in the isolated color timing. GPU speedups remain unmeasured.

## Bottlenecks in this application

1. `quantum.js:857`, `stepSchrodingerCrankNicolsonFixedPointIters`: one RHS pass plus four iterations of a nine-point complex stencil, followed by a whole-grid boundary pass. These independent per-cell calculations are well suited to fragment shaders. Each stencil samples both real and imaginary components at nine sites.
2. The solver repeats rounded/clamped potential-coordinate calculations in every pass, despite the normal potential and simulation grids having identical dimensions. Cache a simulation-sized potential on edits, or use a same-size fast path. Compute per-row offsets outside the x loop. Split interior and edge handling if CPU profiling justifies it.
3. `quantum.js:627`, `drawScene`: creates a fresh ImageData and calls a color mapping function for every cell on every draw. The default mapping performs atan2, hue conversion and returns an RGBA array for every cell. Other schemes also construct palette/stop arrays inside their mapping functions. Move coloring into the display shader. For a CPU fallback, reuse ImageData, hoist palettes and active-scheme selection, and write directly into the byte buffer. JS engines may eliminate some temporary allocations, so verify the actual allocation profile.
4. `drawScene` computes energy on every draw when enabled. `drawOverlayLayer` calls `drawPotentialColorbar`, which scans the entire potential for min/max on every frame even when potential is unchanged. Cache the potential range with invalidation at all edit/import/undo/scale paths. Refresh energy at a modest UI cadence, e.g. 5–10 Hz, while retaining a fresh calculation for explicit inspection/export.
5. Absorption scans all cells to touch only the narrow edge strips. Precompute damping for grid/dt/boundary changes; visit strips on CPU or apply damping in the final solver pass on GPU. Preserve the existing timing of damping: once after all iterations, not in each iteration.
6. `quantum-eigen.js`, `findEigenstates`: `stepSchrodinger()` normalizes when rescale mode is `norm`, then the search normalizes again after orthogonalization. With no previous states the second normalization is redundant; with states, the important normalization is after projection. An eigensearch-specific path could avoid the pre-projection normalization after accuracy checks. Convergence currently copies two arrays and calls Math.hypot per cell; compare squared magnitudes and take a square root once. Batch GPU reductions and read back scalars at convergence checks; keep orthogonalization GPU-resident as the number of states grows.
7. The main loop ties one time step to one display frame. A higher refresh rate changes simulated time per wall-clock second. Use an elapsed-time accumulator with a bounded work budget if the intended UX is a stable simulation speed. Report simulated time advanced per second as well as FPS; a 60 Hz display cannot show 600 FPS even if computation becomes ten times faster.

## What to borrow from the fluid project

[Reference implementation: script.js](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation/blob/master/script.js).

- `createDoubleFBO`: two persistent textures/framebuffers are alternately read and written. Use the same pattern for complex ψ, plus a persistent RHS texture and potential texture. Never sample the output attachment in the same draw.
- `step`: per-cell numerical work is expressed as full-screen shader passes. Its pressure solve performs 20 ping-pong iterations on the GPU. This is an architectural example, not the Schrödinger solver to copy.
- `SIM_RESOLUTION: 128` and `DYE_RESOLUTION: 1024`: expensive fluid fields and visible dye have separate resolutions, adjusted for aspect ratio. Its apparent image detail does not mean the entire fluid solve runs at dye/display resolution.
- `render` / `drawDisplay`: shade the field directly to the display framebuffer. The evolving field stays on GPU; `readPixels` appears in screenshot capture, outside the normal simulation loop.
- `getWebGLContext` / framebuffer initialization: probe texture-rendering capabilities and select supported formats.

Do not copy the fluid demo's half-float precision choice without numerical validation. Quantum phase accumulation, near-cancellation, weak amplitudes, and eigensearch convergence can need more precision than a visual fluid effect.

## Recommended implementation sequence

### 1. Establish accuracy and resolution semantics

The present solver is a **truncated fixed-point approximation** to CN, not a converged CN linear solve. For an eigenmode with energy E, its iteration factor is z=-i dt E/2 in real time. Convergence requires |dt E/2|<1; four iterations alone do not guarantee accuracy, norm conservation, or stability. The stencil's maximum kinetic energy approaches 8/3 in current lattice units. At dt=0.5 and a uniform potential of 1, the highest modes approach an iteration factor of 11/12: convergence is slow even though the factor remains below one. At dt=1 even high-frequency free modes fail the contraction condition.

A direct test with spatially constant ψ=1, closed boundaries and dt=0.5 gives these total-probability ratios after one step:

| Constant V | Computed probability / initial probability |
| --- | ---: |
| 0 | 1 |
| 1 | 0.99908447265625 |
| 2 | 0.953125 |
| 4 | 1 |

Exact real-time evolution for all these cases preserves probability and multiplies ψ by exp(-i V dt). V=4 also illustrates why norm alone is insufficient: the four-iteration result returns ψ=1, while exact evolution has phase -2 radians. Absorption and normalization are disabled in this test. The benchmark reproduces the tests and prints complex outputs too.

Keep the present CPU implementation as a parity reference for the first GPU port, but also compare against analytic solutions and a more accurate reference integrator. Do not optimize by lowering iteration count or switching to explicit Euler: explicit Euler amplifies nonzero-energy real-time modes.

Resolution also needs an explicit definition. Coordinates scale with canvas width, while the solver uses an unscaled lattice Laplacian and the momentum UI uses lattice dispersion units. If resolution is intended as refinement of a fixed continuum problem, introduce consistent dx, kinetic coefficients, momentum conversion, dt, and physical absorbing-layer width. If the model intentionally uses lattice units, preserve and document that interpretation. A sharper display should not silently change these quantities.

### 2. Decouple display, potential artwork, and physics resolution

`drawing-canvas.js:resizeCanvas` currently assigns the same dimensions to the wavefunction and potential canvases; the solver also reads `canvas.width/height` as its grid dimensions. Replace this coupling with explicit simulation dimensions and independent display dimensions.

Render at CSS size × a capped device pixel ratio. Keep the overlay canvas separate. A high-resolution potential/background can remain static between edits and be sampled/downsampled onto the physics grid when edited. Anti-aliasing or area averaging is preferable for thin barriers, but a narrow feature cannot be physically resolved by an arbitrarily coarse physics grid. Retain a source potential rather than repeatedly resampling the latest low-resolution copy.

For display interpolation, interpolate real/imaginary ψ and then compute amplitude/phase; interpolating hue directly creates phase-wrap artifacts. Check rapid phase oscillations and destructive interference, since interpolation can obscure under-resolution.

### 3. Port the solver and display to WebGL2

Suggested starting layout:

- Two `RG32F` ψ textures for ping-pong guesses; one `RG32F` RHS texture; one `R32F` potential texture (or supported RGBA float fallbacks).
- Nearest sampling/texelFetch for numerical stencils and explicitly clamped indices matching today's boundary rule. Reproduce the current nine-point stencil exactly before considering another stencil.
- One RHS pass, four guess passes; fuse post-step damping into the last guess pass. Keep RHS intact while guesses swap.
- One display pass at independent screen resolution, applying the selected color scheme and potential composition. Manual interpolation is an option where float linear filtering is unsupported.
- Update the potential texture on edits, preferably using dirty rectangles. Upload ψ at initialization/import. Download full state only for operations that require it, such as save/export; avoid per-frame readback for energy or UI controls.
- GPU reductions for norm, max amplitude and energy; read a few diagnostic scalars infrequently. Handle exports, eigensearch, state loading, resolution changes, PiP/recording and WebGL context loss explicitly.

WebGL2 float rendering requires runtime extension/format checks; `EXT_color_buffer_float` supports RG32F and R32F render targets. See [MDN extension reference](https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float). Avoid synchronous GPU readbacks in the hot path; see [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices).

WebGL2 is a natural first backend because this stencil maps directly to fragment shaders. WebGPU can be evaluated later for compute/reductions; it is not required to test the primary opportunity. A Worker can improve responsiveness of a CPU fallback but does not itself reduce solver work by ten times.

### 4. Revisit the integrator after GPU parity

A better-converged CN solver, or a suitable split-operator scheme, may allow more accurate evolution per unit work. FFT splitting is an experiment rather than an automatic upgrade: it changes boundary treatment (ordinary FFT implies periodicity), may change the current lattice dispersion unless the matching kinetic symbol is used, and needs many transform passes. ADI would also require careful treatment of the existing diagonal-neighbor stencil. Measure accuracy per simulated unit of time before choosing a replacement.

## Acceptance criteria for the next implementation

- Browser baselines on actual Chrome/Safari and target mobile hardware, at 400×300, 800×600 and 1600×1200 simulation grids; separately test high-resolution display over a fixed physics grid.
- Compare identical dt, initial conditions, potential, boundary mode, simulation duration, color scheme and diagnostics. Record solver throughput, total frame time, p50/p95 latency, GPU time where timer-query extensions are available, and memory. Include recording/PiP workloads separately.
- CPU/GPU parity over one step and many steps; analytic constant-potential phase; closed-boundary norm drift; free-packet dispersion; barrier scattering; absorbing-edge reflections; imaginary-time convergence and eigenstate orthogonality/residuals.
- Set tolerances before assessing speed. Report a tenfold gain only after measuring it at comparable numerical error and the stated grid/display sizes.
