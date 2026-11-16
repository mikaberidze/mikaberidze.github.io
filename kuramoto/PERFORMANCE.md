# Kuramoto computation and rendering review

Implemented 2026-11-16, following the original review below.

## Current implementation

- `sim-core.js`: exact factored sparse forces, compact CSR graphs, O(N) complete
  graphs, free oscillators, float64 CPU Heun reference, bounded wrapped phases.
- `sim-gpu.js`: local WebGPU float32 integration, persistent phase/trig/CSR/scratch
  buffers, cooperative sparse row sums, hierarchical all-node order reduction,
  and compact asynchronous visual snapshots. A batch has up to 64 fixed steps;
  one batch is in flight at a time. Full phase readback occurs only when changing
  topology or switching backends, to preserve undisplayed state.
- `sim-worker.js`: off-main-thread graph construction and CPU/GPU computation,
  cancellation of superseded builds, frequency updates without pipeline rebuilds,
  backend switching with phase preservation, CPU fallback and visible phase
  restart on GPU failure. Automatic mode uses the CPU below 1,024 nodes for
  sparse graphs or 8,192 for free/complete graphs to avoid dispatch overhead.
  These conservative crossover thresholds are heuristics, not device calibration;
  the user can explicitly select GPU or CPU.
- `app.js`: automatic readable playback, an uncapped override, pause, separate coupling-sweep controls, a 0.01 fixed
  timestep, adaptive batches targeting about 8 ms of GPU work including snapshot
  overhead (CPU batches stop after about 10 ms), completion-driven drawing, up to
  1,000 network nodes / 4,000 actual edges / 2,000 phase points, and cached static
  network geometry. Exact r always uses all N oscillators. Automatic mode caps
  systems below 2,000 nodes at 2 simulated seconds per second, using at most
  three steps per visual update to keep motion readable. At 2,000 nodes or above,
  each completed batch immediately submits the next batch before drawing the
  received snapshot, so GPU computation overlaps Canvas rendering with no pacing.
  “Fastest available” also removes pacing for small networks. Explicit pause
  and configuration changes stop submissions; one batch in flight bounds work.
  The browser still presents canvas updates according to its display compositor.
- Canvas backing buffers track CSS dimensions through ResizeObserver, including
  layout changes while paused. Axis transforms account for backing-pixel rounding
  independently so the phase circle has equal displayed x/y scales.
- The size slider and simulation engine enforce an absolute maximum of 20,000
  oscillators at every density. There is no fixed adjacency-memory budget.
  Intermediate densities retain the original seeded pair-hash topology. Actual
  GPU buffer limits are checked while counting edges, before allocating the CSR
  neighbor array; device creation requests the supported limits needed by the
  graph. Allocation/device-limit failures are reported and automatically retried
  at 80% of the previous N until successful (or N=1 fails). The slider and active
  state adopt the successful size. Superseded retries are cancelled. Sparse construction still
  has O(N²) work, now cancellable in a worker. No mean-field approximation or
  neighbor truncation is used in the new simulation.

The UI has concise “speed” and “device” dropdowns, with progress/failure notices
instead of routine implementation commentary. Diagnostics are kept in DOM data
attributes for browser tests, rather than displayed in the simulation.

Runtime GPU storage-buffer limits are checked. Incompatible/unavailable GPUs use
the CPU with a displayed reason. The implementation uses ordinary static JS
modules/module workers, with no build step or external runtime dependencies.
Use HTTPS or a localhost server; opening `index.html` through `file://` is not
supported for module workers.

### Validation and reproduction

```sh
node --test kuramoto/tests/*.test.mjs
node kuramoto/tools/benchmark.mjs
python -m http.server 8765 --bind 127.0.0.1
# Open http://127.0.0.1:8765/kuramoto/tests/browser.html in a WebGPU browser.
# App: http://127.0.0.1:8765/kuramoto/
```

The 10 CPU tests check forces against independent direct-sine sums, undirected
coupling cancellation, topology, analytic two-oscillator timestep convergence,
free drift, wrapping, phase/frequency preservation, sampling and cancellation.
Six scheduling/sizing regressions verify immediate uncapped resubmission before
drawing even with a frozen clock, explicit pause, stale generations, small-system
pacing, large-system throughput, and equal canvas scales after fractional resizes. The app
browser test also disables requestAnimationFrame to check that computation and
snapshot painting are independent of the animation clock.
The browser harness checks GPU versus float64 CPU integration, all-node r and
full checkpoints including undisplayed nodes, unequal workgroup tails, sparse
row/thread paths, up to 20,000 complete oscillators, the maximum batch size,
worker configuration/reset/cancellation, forced CPU operation, missing WebGPU,
and deliberately destroyed GPU-device recovery. An embedded app check exercises
the actual controls, 20k topology, visual budgets, painted canvases, pause,
backend selection, full size range, cancellation and reset. Seven recovery tests
exercise actual-limit checks, allocation backoff, stale-request cancellation and
termination at N=1, including the real worker queue with injected GPU failures.
Fault-injection workers are
test-only and never imported by the app.

Historical browser checks (before the 20,000-node cap) passed in Chrome on Apple M2 Pro. Tested 16-step GPU
phase discrepancies were below 2e-6 radians versus the CPU reference. In one run,
16 Heun steps plus a snapshot took 16.2 ms at N=5,000/D=.05, 10.8 ms at
N=10,000/D=.01, and 4.2 ms at N=100,000/D=1. These are first-batch measurements
including bind-group setup; browser load and hardware affect results. They
exclude painting and are not guaranteed end-to-end frame rates. GPU float32 and
CPU float64 trajectories can diverge over long nonlinear runs.

The app integration check, with adaptive batching and capped drawing enabled,
reported 85.9 simulated seconds per wall-clock second for the 100,000-node
complete graph in one Chrome run. This is a measured local result, not a
cross-device performance guarantee. Browser validation covered Chrome on this
machine; other browser/driver combinations have not been exercised here.
That throughput measurement predates the removal of the 30 Hz drawing cap;
rerun the browser harness to measure the current completion-driven rendering.

Earlier warmed CPU benchmark (M2 Pro, Node v22.13.1; ms; the current harness caps N at 20,000):

| N | D | Legacy sampled force | New exact force | New exact Heun step |
|---:|---:|---:|---:|---:|
| 1,000 | .05 | 1.055 | .089 | .244 |
| 5,000 | .05 | 26.042 | 1.292 | 2.622 |
| 5,000 | 1 | 15.171 | .102 | .219 |
| 10,000 | .01 | 23.366 | 1.211 | 2.406 |
| 100,000 | 1 | — | 2.158 | 4.462 |

The legacy column is the old strided 320-neighbor algorithm retained only in
the benchmark. The new force is exact; Heun takes two force evaluations.
Sampling decisions and different integrators make raw speed ratios insufficient
to compare scientific accuracy. The benchmark does not paint or exercise the GPU.

## Original review (before implementation)

The following findings and proposals describe the original single-file app.
Line numbers refer to that version, not the extracted modules above. Optional
mean-field dynamics, alternate random-graph generation, direct GPU rendering,
and equilibrium detection remain future work.

## Findings

- All integration is JavaScript on the main thread (`stepSimulation`, line 1063).
  There are no WebGPU/WebGL compute calls or workers. Canvas 2D painting may use
  browser acceleration internally; that does not put the differential equations
  on the GPU.
- Graph construction tests every unordered pair, regardless of density
  (`buildOrderedAdjacency`, line 841): O(N²) time and O(DN²) adjacency storage.
  It uses dynamically growing JavaScript arrays with both directions stored.
- Above 320 neighbors, integration uses a deterministic strided subset and
  rescales its sum. Thus dense-network dynamics are already approximate, despite
  the full graph allocation. Changing degree across the threshold changes the
  selected interactions abruptly. Independent row sampling also loses the
  pairwise cancellation of coupling forces in the original undirected graph.
- Every sampled interaction calls `Math.sin(theta[j] - theta[i])`.
- The network drawing cap does not cap traversal: `drawSpring` walks all directed
  adjacency entries every frame before choosing edges to draw. `floor` in its
  stride also permits more than the stated 60,000 lines. All nodes in both views
  are drawn every frame with individual Canvas paths and styles.
- Integration takes one Euler step per animation frame; dt depends on frame rate
  and is capped at 0.1 simulated seconds. Rendering load changes numerical error
  and simulation throughput. The coupling playback controls sweep K; they do
  not provide an independent relaxation speed control.
- Phases grow without wrapping. This is particularly problematic for a future
  float32 GPU backend in long accelerated runs.
- History logging emits a console object every 180 ms. DOM labels are rewritten
  each frame, and canvases repeatedly query layout. These are secondary costs.
- During the 140 ms structural debounce, requested N/D overwrite active N/D
  before the graph is rebuilt; coupling normalization can temporarily use the
  requested graph size/density with the old graph. Separate requested and active
  configurations when restructuring the engine.

## CPU experiments

These measurements were captured before implementation with an earlier version
of `tools/benchmark.mjs`, extracting the original graph builder/integrator from
`index.html`. That harness checked factored sampled forces against direct-sine
sums and complete-graph reduction against exact adjacency (tolerance 1e-11).
The current benchmark imports the implemented engine instead; current numerical
checks live in `tests/` as described above.

One run on Apple M2 Pro, Node v22.13.1, darwin/arm64:

| N | D | Undirected edges | Build ms | Current force ms | Factored, same sampling ms | Factored, all edges ms | Exact complete reduction ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | .05 | 25,150 | 4.659 | .952 | .121 | .076 | — |
| 5,000 | .05 | 625,091 | 43.654 | 23.932 | 1.436 | 1.412 | — |
| 5,000 | 1 | 12,497,500 | 391.598 | 20.014 | 9.985 | 26.339 | .098 |
| 10,000 | .01 | 499,085 | 67.887 | 19.676 | 1.518 | 1.346 | — |

Force timings are medians of 15 calls after five warmups, with dt=0 for the
current kernel to isolate its force calculation without evolving the phases.
Graph build is a single cold call. Phases/frequencies are deterministic synthetic
inputs; values vary with hardware, JIT, cache state and phase distribution.
The exact and sampled kernels have separate JIT paths: tiny timing differences
at low degree are noise/optimization differences, not evidence that summing more
edges is faster. No browser painting, GPU dispatch, transfer cost, or end-to-end
speedup was measured. These results establish promising algorithms, not a GPU
performance claim.

## First improve the mathematics

For each integration stage compute `s[i] = sin(theta[i])`, `c[i] = cos(theta[i])`
once. Then the exact force is:

```text
S[i] = sum over neighbors j of s[j]
C[i] = sum over neighbors j of c[j]
dtheta[i]/dt = omega[i] + K/max(1, D*N) * (c[i]*S[i] - s[i]*C[i])
```

This is two sparse matrix/vector products sharing one adjacency traversal. It
replaces O(edges) transcendental evaluations with O(N). It works on CPU and GPU,
and does not require approximating a sparse graph. The benchmark also applies
the existing sampling/weighting to demonstrate a compatible transitional kernel.
Default the new engine to exact forces; if preserving the legacy approximation
is useful, expose it explicitly rather than silently retaining it.

At D=1, every row uses the same global sums S and C. Reduce each once, then
update every oscillator in O(N) total work and memory. Including self in those
sums contributes zero. Keep K/N, as in the current equation, not K/(N-1).
No adjacency allocation is necessary for this case. At D=0, integrate free
oscillators directly and allocate no adjacency.

For 0<D<1, substituting global S/C is a *different* model: the annealed/mean-field
approximation replaces the particular random network with its expectation. It
can support huge systems, but must be a separate, labeled choice. In particular,
it loses finite-degree fluctuations, components and isolated-node behavior.
Visual sampling alone has none of these effects on the model.

## Recommended WebGPU engine

Use browser WebGPU compute shaders, automatically selected when adapter/device
creation succeeds. Retain a CPU worker fallback and a measured crossover for
small workloads, where dispatch overhead can outweigh parallelism. Feature
detection, allocation failures and device loss must be handled; browser name
alone is not a capability check. Serve through HTTPS or localhost.

Keep phases, frequencies, trig vectors, adjacency, intermediate sums and
integrator scratch buffers on the GPU. Use float32 for these values, uint32 for
indices/offsets. Initial conditions and graph uploads happen on reset/rebuild;
slider changes usually upload only a small parameter block. Do not upload or
read back all N phases every frame.

Proposed stage dispatches:

1. Compute `(sin(theta), cos(theta))` per node, and optional workgroup partial
   sums for the complete-graph/order-parameter paths.
2. Sparse case: gather neighbor trig values and evaluate the force. For small
   degrees, start with one invocation per row. For larger degrees, one workgroup
   per row lets lanes sum strided neighbors, followed by a workgroup reduction.
   Benchmark both layouts and workgroup sizes, initially 64/128. Avoid per-edge
   floating-point scatter atomics. Complete graph: hierarchically reduce trig
   partials, then use global S/C for every node instead.
3. Integrate into a separate output phase buffer and swap buffers. Never update
   phases in place while other invocations still read the old state. Recompute
   trig values for every integrator stage that needs a new state.
4. At display/measurement cadence, reduce the current state to global S/C for
   exact all-node `r=hypot(S,C)/N`, `psi=atan2(S,C)`. Workgroup barriers do not
   synchronize separate workgroups: use separate dispatches for global reduction
   stages. Do not assume optional subgroups are available.

Batch several fixed integration steps in one command submission. Render at most
30–60 Hz and measure at an independently chosen cadence. Bound in-flight work
and batch size to keep controls responsive; tune toward a short GPU work budget
rather than enqueueing unbounded steps. Do not await GPU completion per step.

For a first implementation, keep Canvas rendering: gather a stable sample of
phases plus exact order statistics into a compact snapshot on the GPU, copy it
to staging buffers and map asynchronously. Use a small staging-buffer pool and
skip a snapshot when all are busy; continue displaying the latest completed
one. Include simulation time, K, and a graph/reset generation ID so delayed
results cannot populate history with the wrong coupling or resurrect old state.
Separate render-sample arrays from full CPU engine arrays. Longer term,
instanced WebGPU drawing can consume simulation buffers directly with no phase
readback, but is not necessary for the first major improvement.

On device loss, recover from the last checkpoint or visibly restart. Do not
silently resume from stale initial CPU arrays. Dispose old buffers on rebuild
and reject stale asynchronous results using generation IDs.

## Graph storage and larger N

Use compressed sparse rows (CSR): `offsets[N+1]`, `neighbors[2E]`. Approximate
storage is `4*(N+1) + 8*E` bytes, excluding scratch and construction overhead.

| Example | Approximate CSR size |
|---|---:|
| N=5,000, D=.05 | 5 MB |
| N=100,000, D=.05 | 2 GB |
| N=100,000, expected degree=100 | 40.4 MB |
| Complete graph, any N | O(N) state; no CSR needed |

Thus a GPU does not make large fixed-density random graphs cheap. At fixed D,
E grows quadratically. A target-degree input is useful for scaling sparse
networks; retain D as an option and show estimated memory before construction.
Query device limits, including buffer binding size, and set feasible limits
before raising the N slider. The standard core default storage binding limit
is 128 MiB; adapters may expose higher limits, which must be requested when
creating the device. Large graphs may require chunking even with enough total
memory. Do not equate maximum buffer size with usable total device memory.

Move graph construction to a worker first, with cancellation/coalescing for
slider changes. Preserve the existing pair hash and seed if graph identity and
nested density changes must remain reproducible: a CSR builder can count edges,
prefix-sum degrees and fill rows, but still costs O(N²) hash evaluations.

An expected O(N+E) Bernoulli skip generator can avoid testing all absent edges
at low density. It preserves the random-graph distribution, not this particular
hash-defined graph or its nesting as N/D changes. Treat that as an explicit
generation-policy decision. Workers alone do not change asymptotic costs.

For exact moderately dense random graphs, a bitset is another tradeoff: smaller
adjacency storage but scanning remains O(N²), and at N=100,000 even full row
bitsets need about 1.25 GB. Computing the hash inside a tiled GPU kernel avoids
adjacency storage at the cost of testing every pair every stage. Neither should
be the default scaling strategy. Offer clearly labeled mean-field dynamics if
very large dense random systems are desired.

## Rendering without changing dynamics

- Use a fixed, seeded, phase-independent node sample: initially at most 1,000
  network nodes and 2,000 phase-circle points. Keep the sample stable across
  frames to avoid flicker and sampling bias. Tune these budgets on real devices.
- Build a capped list of actual edges between displayed network nodes once per
  topology change, initially at most 4,000 lines. This is a sampled induced
  view, not a claim to show every connection. Scan the displayed pairs or sample
  their actual adjacency; never traverse the full graph during painting.
- Cache network positions, edge paths/background and orbit outlines until
  resize/topology changes. Draw only moving satellites each visual frame.
- Compute r from **all** oscillators, even when displaying a subset. Show
  “displaying X of N nodes” and a displayed-edge count.
- Cache dimensions on resize; consider a device-pixel-ratio cap for small plots.
  Update DOM labels on parameter changes. Remove the periodic debug logging.
  Redraw the K/r plot only on new data or UI changes (currently ~5.6 Hz logging),
  rather than repainting its grid and history every animation frame.

## Faster relaxation with controlled numerical error

Separate simulated time from drawing and from K playback. Add an independent
simulation-rate/fast-relax control that increases the number of fixed steps per
wall-clock second. Sweep K per **simulated** second, with the option to hold K
fixed while relaxing. Merely increasing Euler dt makes the approximation less
accurate and can create apparent locking artifacts.

Use fixed-step Heun (two force stages) as a candidate against fixed-step Euler;
compare error per unit computation before selecting a default. Start convergence
experiments at h=.01 and h=.005, including the largest K/frequency spread. Wrap
phases to a bounded interval after updates. Compare circular distances and r,
not unwrapped trajectories, and keep float64 CPU reference calculations.

A rotating frame can remove the common mean frequency, with the display angle
restored from a separate clock. It does not change r or phase differences and
helps phase precision; it does not remove stiffness due to coupling or disorder.

Do not infer equilibrium just because r is momentarily flat: incoherent states
can remain time dependent, and near-threshold relaxation can be physically slow.
An optional “relax at fixed K” mode should use a minimum settling interval,
windowed r statistics and diagnostics such as relative phase-velocity spread,
then label whether it hit its tolerance or its simulation-time budget. Full
phase locking is not expected at every K. Acceleration shortens wall time to a
given physical state; it does not eliminate critical slowing down in the model.

## Implementation sequence and acceptance checks

1. Factor trigonometry, special-case D=0/1, bound rendering traversal and sample
   only the visuals. Separate active graph parameters from pending controls.
   Measure browser compute, paint, graph-build and UI-response times separately.
2. Extract engine/state from the page into modules. Add a fixed-step scheduler,
   independent simulation speed and worker fallback; preserve resets, frequency
   changes, seeded graph behavior and coupling playback.
3. Add WebGPU CSR and complete-graph kernels, asynchronous sampled snapshots,
   exact all-node reductions, device-limit checks and recovery.
4. Raise size limits according to topology/memory budgets. Consider alternate
   random-graph construction and optional mean-field dynamics separately.

Validate GPU derivatives against exact float64 direct-sine forces on small
seeded graphs (including empty, complete, isolated nodes and unequal degrees).
Check undirected coupling-force cancellation, zero K/free drift, identical
frequencies, and timestep convergence on both sides of the transition. Compare
long-run distributions/time averages rather than expecting indefinite pointwise
agreement from float32 nonlinear trajectories. Validate the sampled legacy
kernel separately from the exact model. Test missing WebGPU, denied adapter,
allocation/device loss, rapid slider/rebuild/reset changes and delayed snapshots.

Benchmark simulated seconds per wall second at a stated timestep and error,
alongside UI latency, memory and render frame time. Target complete graphs near
100k nodes and sparse graphs near 100k/degree 100 as experiments, not promises;
actual limits and gains require browser GPU measurements. Verify that r uses
all N nodes and that rendering cost stays bounded as N/E grow.

## Primary API references

- [WebGPU specification](https://gpuweb.github.io/gpuweb/): device limits,
  compute/storage buffers, command submission, asynchronous mapping, device loss.
- [WGSL specification](https://gpuweb.github.io/gpuweb/wgsl/): shader data layout,
  floating-point behavior and workgroup synchronization.
- [Chrome compute introduction](https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu):
  WebGPU compute versus WebGL rendering stages.
