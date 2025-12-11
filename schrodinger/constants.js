// Shared configuration constants for the Schrödinger playground.
// Tweak these in one place to change simulation, drawing, or UI behavior.

// --- Simulation grid & spatial scaling ---

// Reference resolution used when converting between world coordinates
// (x, y in simulation units) and pixel coordinates.
const BASE_RESOLUTION = 1000;

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
const TIME_STEP = 0.1;

// Mutable time step used by the integrators; the UI can change this.
let currentTimeStep = TIME_STEP;

// Number of Schrödinger steps taken per animation frame.
// Higher values evolve faster but cost more CPU per frame.
const STEPS_PER_FRAME = 1;

// Number of fixed-point iterations used in the Crank–Nicolson solver.
// More iterations → better unitarity / stability, but slower.
const CN_ITERS = 4;


// --- Potential & absorbing boundaries ---

// Scales the [0, 1] potential values from drawing into the physical potential V.
// Larger values make barriers "higher" relative to kinetic energy.
const POTENTIAL_SCALE = 1;

// Default maximum physical potential corresponding to white when importing images.
const INITIAL_V_MAX = 1;

// Thickness (in grid cells) of the imaginary absorbing layer at each boundary.
const ABSORB_LAYERS = 3;

// Maximum strength of the imaginary absorbing potential at the very edge.
// Larger values absorb more strongly but can reflect if too abrupt.
const ABSORB_MAX = 1;


// --- Particle controls & sliders ---

// Maximum momentum magnitude |p| in the dispersion-based units
// p = 2 sin(k / 2). This limits the norm of the momentum vector.
const MAX_P = 1;

// Target product σ_x · σ_p used to enforce the uncertainty constraint.
const PRODUCT_TARGET = 0.5;

// Minimum radius (in canvas pixels) for the σ_r circle in the particle overlay.
const MIN_PARTICLE_RADIUS_PX = 10;


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
const MAX_HISTORY = 100;


// --- Overlay styling ---

// Accent color used for UI overlays (colorbar labels, energy text, signature).
const OVERLAY_ACCENT_COLOR = "#42ca76";

// Supersampling factor for overlay canvas resolution relative to the
// underlying simulation grid. For example, 2 means the overlay canvas
// has twice the width and height (4× pixels) of the simulation.
const OVERLAY_SUPERSAMPLE_FACTOR = 2;
