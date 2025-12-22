// Shared configuration constants for the Schrödinger playground.
// Tweak these in one place to change simulation, drawing, or UI behavior.


// --- Simulation grid & spatial scaling ---

// Reference resolution used when converting between world coordinates
// (x, y in simulation units) and pixel coordinates.
const BASE_RESOLUTION = 100;

// Actual internal pixel resolution of the simulation grid in pixels.
// These can be non-square; aspect ratio = WIDTH / HEIGHT.
// Can be lower than BASE_RESOLUTION if you want a coarser grid.
const TARGET_RESOLUTION_WIDTH = 400;
const TARGET_RESOLUTION_HEIGHT = 300;

// Mutable copies used at runtime; the UI can tweak these without
// changing the baseline constants above.
let currentResolutionWidth = TARGET_RESOLUTION_WIDTH;
let currentResolutionHeight = TARGET_RESOLUTION_HEIGHT;

// Position scale: how many simulation units span roughly half the canvas.
// Larger values zoom out (more units fit into the same pixels).
const BASE_SCALE_POS = 20;



// --- Time evolution ---

// Time step Δt used in each Schrödinger integration step (dimensionless units).
const TIME_STEP = 0.5;

// Mutable time step used by the integrators; the UI can change this.
let currentTimeStep = TIME_STEP;

// If true, evolve in imaginary time (t → -iτ) to relax toward the ground state.
let isImaginaryTime = false;

// Time integrator for real-time evolution:
// "crank" – Crank–Nicolson (default),
// "euler" – explicit Euler.
let integratorScheme = "crank";

// Wavefunction rescaling mode after each Schrödinger step:
// "none"  – no rescaling (default),
// "norm"  – normalize total probability to 1,
// "max"   – scale so max |ψ| = 1.
let psiRescaleMode = "none";

// Number of Schrödinger steps taken per animation frame.
// Higher values evolve faster but cost more CPU per frame.
const STEPS_PER_FRAME = 1;

// Number of fixed-point iterations used in the Crank–Nicolson solver.
// More iterations → better unitarity / stability, but slower.
const CN_ITERS = 4;



// --- Eigenstate search ---

// Convergence threshold exponent for imaginary-time relaxation when searching for
// eigenstates. The search stops once the maximum per-pixel change in |ψ|
// between successive iterations falls below 10^{EIGENSTATE_RELAXATION_DELTA_EXP}.
const EIGENSTATE_RELAXATION_DELTA_EXP = -6;

// Exponent controlling the safety cap on the number of imaginary-time iterations
// allowed per eigenstate before giving up on convergence. The default cap is
// 10^{EIGENSTATE_MAX_ITERATIONS_EXP}.
const EIGENSTATE_MAX_ITERATIONS_EXP = 5;

// How frequently (in iterations) the eigenstate finder yields back to
// the browser event loop and optionally refreshes the canvas.
const EIGENSTATE_DRAW_EVERY_N_STEPS = 25;

// Width (in simulation units) of the broad Gaussian packet used as a
// random initial condition when searching for eigenstates.
const EIGENSTATE_GAUSSIAN_SIGMA_R = 2;



// --- Potential & absorbing boundaries ---

// Scales the [0, 1] potential values from drawing into the physical potential V.
// Larger values make barriers "higher" relative to kinetic energy.
const POTENTIAL_SCALE = 1;

// Default maximum physical potential corresponding to white when importing images.
const INITIAL_V_MAX = 1;

// Thickness (in grid cells) of the imaginary absorbing layer at each boundary.
const ABSORB_LAYERS = 5;

// Maximum strength of the imaginary absorbing potential at the very edge.
// Larger values absorb more strongly but can reflect if too abrupt.
const ABSORB_MAX = 1;



// --- Particle controls & sliders ---

// Maximum momentum magnitude |p| in the dispersion-based units
// p = 2 sin(k / 2). This limits the norm of the momentum vector.
const MAX_P = 1;

// Target product σ_r · σ_p used to enforce the uncertainty constraint.
const PRODUCT_TARGET = 0.5;

// Minimum radius (in canvas pixels) for the σ_r circle in the particle overlay.
const MIN_PARTICLE_RADIUS_PX = 10;

// Initial Gaussian packet properties (internal momentum parameters and σ_r).
const INITIAL_PX_INTERNAL = 100;
const INITIAL_PY_INTERNAL = 0;
const INITIAL_SIGMA_R = 0.2;



// --- Drawing & potential editing ---

// Default potential gray value (0–255) for the "Barrier level" slider.
const INITIAL_POTENTIAL_GRAY = 128;

// Default brush size (in potential pixels).
const INITIAL_BRUSH_SIZE = 10;

// Default shape outline thickness (in potential pixels).
const INITIAL_SHAPE_THICKNESS = 5;

// Default brush hardness in [0, 1] for edge softness.
const INITIAL_BRUSH_HARDNESS = 0.9;

// Distance between consecutive brush "stamps" as a fraction of brush size.
const BRUSH_SPACING_FACTOR = 0.1;

// Value tolerance for bucket fill when deciding whether two pixels
// belong to the same region (in normalized potential units).
const BUCKET_TOLERANCE = 0.1;

// Maximum number of potential snapshots kept for undo/redo.
const MAX_HISTORY = 30;



// --- Overlay styling ---

// Accent color used for UI overlays (colorbar labels, energy text, signature).
const OVERLAY_ACCENT_COLOR = "#42ca76";

// Fixed base width (in device pixels) for the overlay canvas. Height is derived
// from this width and the current simulation aspect ratio.
const OVERLAY_CANVAS_BASE_WIDTH = 900;



// --- Analytics helpers ---

const DEFAULT_EXPERIMENT_NAME = "Custom setup";
let analyticsExperimentName = DEFAULT_EXPERIMENT_NAME;
let analyticsExperimentSource = "custom";
let analyticsSimulationStart = null;

function analyticsTimestampMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function trackAnalyticsEvent(eventName, params = {}) {
  if (!eventName) return;
  try {
    if (typeof gtag === "function") {
      gtag("event", eventName, params);
    } else if (typeof window !== "undefined" && Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...params });
    }
  } catch (err) {
    console.warn("[Schrödinger] Analytics event failed:", err);
  }
}

function setAnalyticsExperiment(name, source = "custom", options = {}) {
  const normalizedName =
    name && String(name).trim()
      ? String(name).trim()
      : DEFAULT_EXPERIMENT_NAME;

  analyticsExperimentName = normalizedName;
  analyticsExperimentSource = source || "custom";

  const emitEvent =
    !options || typeof options.emitEvent === "undefined"
      ? true
      : !!options.emitEvent;

  if (emitEvent) {
    trackAnalyticsEvent("experiment_loaded", {
      experiment_name: analyticsExperimentName,
      experiment_source: analyticsExperimentSource,
    });
  }

  // Reset any in-progress timer when switching experiments.
  analyticsSimulationStart = null;
}

function startSimulationAnalytics() {
  if (analyticsSimulationStart === null) {
    analyticsSimulationStart = analyticsTimestampMs();
  }
}

function stopSimulationAnalytics(reason = "stop") {
  if (analyticsSimulationStart === null) return;
  const durationMs = Math.max(0, analyticsTimestampMs() - analyticsSimulationStart);
  analyticsSimulationStart = null;

  if (durationMs < 10) return;

  trackAnalyticsEvent("simulation_duration", {
    experiment_name: analyticsExperimentName,
    experiment_source: analyticsExperimentSource,
    duration_ms: Math.round(durationMs),
    duration_seconds: Number((durationMs / 1000).toFixed(2)),
    stop_reason: reason,
  });
}

function trackToolUsage(category, detail = {}) {
  if (!category) return;
  trackAnalyticsEvent("tool_usage", {
    tool_category: category,
    ...detail,
  });
}

// Register the default starting experiment.
setAnalyticsExperiment(DEFAULT_EXPERIMENT_NAME, "default");
