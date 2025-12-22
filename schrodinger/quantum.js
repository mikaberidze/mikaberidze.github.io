// Quantum mechanics: wavefunction and time evolution

// Complex wavefunction φ(x, y; μx, μy, σx, σy, μpx, μpy, normalized)
// Returns an object { re, im, normFactor } where normFactor is the
// analytic normalization coefficient that can be applied separately
// if desired.
function phi(x, y, mu_x, mu_y, sigma_x, sigma_y, mu_px, mu_py, normalized = false) {
  const twoPi = 2 * Math.PI;

  // Normalization factors (2πσ_x^2)^(-1/4) and (2πσ_y^2)^(-1/4)
  const normX = Math.pow(twoPi * sigma_x * sigma_x, -0.25);
  const normY = Math.pow(twoPi * sigma_y * sigma_y, -0.25);
  const normFactor = normX * normY;

  // Gaussian envelopes exp(-(x - μ_x)^2 / (4σ_x^2)) and exp(-(y - μ_y)^2 / (4σ_y^2))
  const gaussX = Math.exp(-((x - mu_x) * (x - mu_x)) / (4 * sigma_x * sigma_x));
  const gaussY = Math.exp(-((y - mu_y) * (y - mu_y)) / (4 * sigma_y * sigma_y));

  const ampX = gaussX * (normalized ? normX : 1);
  const ampY = gaussY * (normalized ? normY : 1);

  // Phases exp(i x μ_px) and exp(i y μ_py)
  const phaseX = x * mu_px;
  const phaseY = y * mu_py;

  // Complex factors for x and y
  const axRe = ampX * Math.cos(phaseX);
  const axIm = ampX * Math.sin(phaseX);

  const ayRe = ampY * Math.cos(phaseY);
  const ayIm = ampY * Math.sin(phaseY);

  // φ = (A_x) * (A_y)
  return {
    re: axRe * ayRe - axIm * ayIm,
    im: axRe * ayIm + axIm * ayRe,
    normFactor,
  };
}

// Simulation canvases
let canvas;
let ctx;

// High-resolution overlay canvas for colorbar, energy, and signature.
let overlayCanvas = null;
let overlayCtx = null;

// Potential field (real part of V)
let potentialField = null;
let potentialWidth = 0;
let potentialHeight = 0;

// Wavefunction ψ = ψ_re + i ψ_im on the grid
let psiRe = null;
let psiIm = null;
let psiReNext = null;
let psiImNext = null;
let simWidth = 0;
let simHeight = 0;

// Scratch buffers for the Crank–Nicolson integrator right-hand side.
let cnRhsRe = null;
let cnRhsIm = null;

// Time evolution state
let isPlaying = false;
let animationFrameId = null;

let initialPsiDirty = true;
// True when the current wavefunction can be fully reconstructed
// from the analytic initial-condition controls (no time evolution
// or other non-analytic modifications have been applied).
let wavefunctionCanBeReconstructedFromControls = true;

let simTime = 0;
let frameCount = 0;
let lastLogTime = 0;

// Boundary condition mode: "open" uses imaginary absorbing layers at the edges,
// "closed" omits the absorbing potential (Neumann reflection only).
let boundaryMode = "open";

// Optional overlays
let showColorbar = true;
let showEnergy = true;
let lastEnergyValue = null;
let showPhaseCircle = false;

// Analytic normalization factor returned by phi for the current
// initial wavefunction shape (independent of x, y).
let currentNormFactor = 1;

// Discovered eigenstates ψ_n stored as { re: Float32Array, im: Float32Array }.
// These are defined on the current simulation grid and are invalidated when
// the grid resolution or potential changes.
let eigenstates = [];

// True while an eigenstate search (imaginary-time relaxation) is in progress.
let eigenstateSearchInProgress = false;

// Fixed visualization scale factor for plotting |ψ| on the canvas. This is
// recomputed whenever a new wavefunction is constructed or loaded, not every frame.
let plotScaleFactor = 1;

// Mutable convergence threshold for eigenstate relaxation, initialized from
// the default exponent constant but adjustable from the UI.
let eigenstateRelaxationDelta =
  typeof EIGENSTATE_RELAXATION_DELTA_EXP === "number" &&
  Number.isFinite(EIGENSTATE_RELAXATION_DELTA_EXP)
    ? Math.pow(10, EIGENSTATE_RELAXATION_DELTA_EXP)
    : 1e-6;

// Mutable cap on the number of imaginary-time iterations per eigenstate, initialized
// from the default exponent constant but adjustable from the UI.
let eigenstateMaxIterationsPerState =
  typeof EIGENSTATE_MAX_ITERATIONS_EXP === "number" &&
  Number.isFinite(EIGENSTATE_MAX_ITERATIONS_EXP)
    ? Math.max(1, Math.round(Math.pow(10, EIGENSTATE_MAX_ITERATIONS_EXP)))
    : 100000;

// Compute the physical potential range used for color mapping.
// V_max (white) corresponds to max between the field maximum and POTENTIAL_SCALE.
// V_min (black) corresponds to min between 0 and the field minimum.
function getPotentialRange() {
  const scale =
    typeof POTENTIAL_SCALE === "number" && Number.isFinite(POTENTIAL_SCALE)
      ? POTENTIAL_SCALE
      : 1;

  if (!potentialField || !potentialField.length || !Number.isFinite(scale)) {
    const defaultMin = 0;
    const defaultMax = scale > 0 ? scale : 1;
    return { minV: defaultMin, maxV: defaultMax };
  }

  let rawMin = Infinity;
  let rawMax = -Infinity;

  const n = potentialField.length;
  for (let i = 0; i < n; i++) {
    const vNorm = potentialField[i];
    if (!Number.isFinite(vNorm)) continue;
    const v = vNorm * scale;
    if (v < rawMin) rawMin = v;
    if (v > rawMax) rawMax = v;
  }

  if (!Number.isFinite(rawMin)) {
    rawMin = 0;
  }
  if (!Number.isFinite(rawMax)) {
    rawMax = 0;
  }

  let minV = Math.min(0, rawMin);
  let maxV = Math.max(rawMax, scale > 0 ? scale : 1);

  // Avoid a degenerate range; fall back to a small symmetric interval.
  if (!Number.isFinite(minV) || !Number.isFinite(maxV) || minV === maxV) {
    const center = Number.isFinite(minV) ? minV : 0;
    const span = Math.max(Math.abs(center), scale, 1);
    minV = center - 0.5 * span;
    maxV = center + 0.5 * span;
  }

  return { minV, maxV };
}

function initPotentialField(width, height) {
  potentialWidth = width;
  potentialHeight = height;
  potentialField = new Float32Array(width * height);
  // Potential change invalidates previously found eigenstates.
  eigenstates = [];
}

function initSimulationGrid(width, height) {
  simWidth = width;
  simHeight = height;
  psiRe = new Float32Array(width * height);
  psiIm = new Float32Array(width * height);
  psiReNext = new Float32Array(width * height);
  psiImNext = new Float32Array(width * height);
  initialPsiDirty = true;
  // Grid changes invalidate previously found eigenstates.
  eigenstates = [];
}

function markInitialPsiDirty() {
  if (!isPlaying) {
    initialPsiDirty = true;
  }
}

// Color mapping for complex wavefunctions. Encapsulated so additional
// schemes can be added later without touching the rest of the code.
const COMPLEX_COLOR_SCHEMES = {
  phase: {
    id: "phase",
    label: "Phase (rainbow)",
    // Map complex value (re, im) to RGBA using amplitude for alpha
    // and argument for a rainbow hue.
    map(re, im) {
      const amp2 = re * re + im * im;

      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));

      // Hue from angle in [-π, π]
      const angle = Math.atan2(im, re);
      const h = (angle + Math.PI) / (2 * Math.PI); // [0,1)

      const i = Math.floor(h * 6);
      const f = h * 6 - i;
      const q = 1 - f;

      let r, g, b;
      switch (i % 6) {
        case 0:
          r = 1;
          g = f;
          b = 0;
          break;
        case 1:
          r = q;
          g = 1;
          b = 0;
          break;
        case 2:
          r = 0;
          g = 1;
          b = f;
          break;
        case 3:
          r = 0;
          g = q;
          b = 1;
          break;
        case 4:
          r = f;
          g = 0;
          b = 1;
          break;
        case 5:
        default:
          r = 1;
          g = 0;
          b = q;
          break;
      }

      return [
        Math.round(r * 255),
        Math.round(g * 255),
        Math.round(b * 255),
        Math.round(alpha * 255),
      ];
    },
  },
  qualitativeSoft: {
    id: "qualitativeSoft",
    label: "Qualitative (soft)",
    // Phase-binned pastel qualitative scheme; amplitude controls opacity.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      const palette = [
        { r: 249, g: 168, b: 212 }, // pink-300
        { r: 110, g: 231, b: 183 }, // emerald-300 (brighter green)
        { r: 147, g: 197, b: 253 }, // blue-300 (more vivid blue)
      ];

      const n = palette.length;
      const angle = Math.atan2(im, re);
      // Map phase with an additional 30° rotation so that
      // the soft pastel bands are rotated relative to the
      // default phase reference.
      let u =
        (angle + Math.PI) / (2 * Math.PI) +
        1 / 12; // +30° = 1/12 of a full turn
      if (!Number.isFinite(u)) u = 0;
      u = u - Math.floor(u); // wrap to [0,1)
      let idx = Math.floor(u * n);
      if (idx < 0) idx = 0;
      if (idx >= n) idx = n - 1;
      const c = palette[idx];

      return [c.r, c.g, c.b, Math.round(alpha * 255)];
    },
  },
  qualitativeBold: {
    id: "qualitativeBold",
    label: "Qualitative (bold)",
    // Phase-binned saturated qualitative scheme; amplitude controls opacity.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      const palette = [
        { r: 239, g: 68, b: 68 },   // red-500
        { r: 249, g: 115, b: 22 },  // orange-500
        { r: 234, g: 179, b: 8 },   // yellow-500
        { r: 34, g: 197, b: 94 },   // emerald-500
        { r: 59, g: 130, b: 246 },  // blue-500
        { r: 139, g: 92, b: 246 },  // violet-500
      ];

      const n = palette.length;
      const angle = Math.atan2(im, re);
      let u = (angle + Math.PI) / (2 * Math.PI);
      if (n % 2 === 0) {
        u += 0.5 / n;
      }
      if (!Number.isFinite(u)) u = 0;
      u = u - Math.floor(u); // wrap to [0,1)
      let idx = Math.floor(u * n);
      if (idx < 0) idx = 0;
      if (idx >= n) idx = n - 1;
      const c = palette[idx];

      return [c.r, c.g, c.b, Math.round(alpha * 255)];
    },
  },
  gold: {
    id: "gold",
    label: "Gold",
    // Amplitude-based golden colormap: darker background for small |ψ|,
    // bright gold for large |ψ|.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      let t = Math.sqrt(amp2);
      if (!Number.isFinite(t)) t = 0;
      t = Math.max(0, Math.min(1, t));

      const stops = [
        { r: 5, g: 7, b: 12 },    // very dark
        { r: 92, g: 59, b: 0 },   // deep gold-brown
        { r: 207, g: 166, b: 58 },// rich gold
        { r: 255, g: 226, b: 138 },// bright gold
        { r: 255, g: 246, b: 207 },// pale highlight
      ];

      const scaled = t * (stops.length - 1);
      const idx = Math.max(
        0,
        Math.min(stops.length - 2, Math.floor(scaled))
      );
      const localT = scaled - idx;
      const c0 = stops[idx];
      const c1 = stops[idx + 1];

      const r = Math.round(c0.r + (c1.r - c0.r) * localT);
      const g = Math.round(c0.g + (c1.g - c0.g) * localT);
      const b = Math.round(c0.b + (c1.b - c0.b) * localT);

      return [r, g, b, Math.round(alpha * 255)];
    },
  },
  heat: {
    id: "heat",
    label: "Heatmap",
    // Amplitude-based heatmap: dark background for small |ψ|,
    // bright yellow-white for large |ψ|.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      let t = Math.sqrt(amp2);
      if (!Number.isFinite(t)) t = 0;
      t = Math.max(0, Math.min(1, t));

      const stops = [
        { r: 5, g: 7, b: 12 },     // very dark
        { r: 127, g: 29, b: 29 },  // dark red
        { r: 249, g: 115, b: 22 }, // orange
        { r: 250, g: 204, b: 21 }, // yellow
        { r: 254, g: 252, b: 232 },// near white
      ];

      const scaled = t * (stops.length - 1);
      const idx = Math.max(
        0,
        Math.min(stops.length - 2, Math.floor(scaled))
      );
      const localT = scaled - idx;
      const c0 = stops[idx];
      const c1 = stops[idx + 1];

      const r = Math.round(c0.r + (c1.r - c0.r) * localT);
      const g = Math.round(c0.g + (c1.g - c0.g) * localT);
      const b = Math.round(c0.b + (c1.b - c0.b) * localT);

      return [r, g, b, Math.round(alpha * 255)];
    },
  },
  probGray: {
    id: "probGray",
    label: "Grayscale (probability)",
    // Amplitude-based grayscale: dark for small |ψ|, bright for large |ψ|.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      let t = Math.sqrt(amp2);
      if (!Number.isFinite(t)) t = 0;
      t = Math.max(0, Math.min(1, t));

      const v = Math.round(t * 255);
      return [v, v, v, Math.round(alpha * 255)];
    },
  },
  probGrayHot: {
    id: "probGrayHot",
    label: "Grayscale + red peaks",
    // Amplitude-based grayscale with the top 10% of |ψ| highlighted
    // in a red gradient from dark red to bright red.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      let t = Math.sqrt(amp2);
      if (!Number.isFinite(t)) t = 0;
      t = Math.max(0, Math.min(1, t));

      const threshold = 0.9;
      const v = Math.max(0, Math.min(1, t)) * 255;

      if (t <= threshold) {
        const gv = Math.round(v);
        return [gv, gv, gv, Math.round(alpha * 255)];
      }

      // Above the threshold, use a very short gray→red ramp
      // and then a flat bright red region so the onset feels
      // abrupt: black → gray → (tiny ramp) → solid red.
      const maxT = 1;
      const rampWidth = Math.min(0.02, maxT - threshold); // ~2% of full range
      const rampEnd = threshold + rampWidth;

      const gray = { r: v, g: v, b: v };
      const hot = { r: 185, g: 28, b: 28 }; // #b91c1c – deeper red

      let r, g, b;
      if (t <= rampEnd) {
        const localT = (t - threshold) / rampWidth; // 0..1 over tiny ramp
        r = Math.round(gray.r + (hot.r - gray.r) * localT);
        g = Math.round(gray.g + (hot.g - gray.g) * localT);
        b = Math.round(gray.b + (hot.b - gray.b) * localT);
      } else {
        r = hot.r;
        g = hot.g;
        b = hot.b;
      }

      return [r, g, b, Math.round(alpha * 255)];
    },
  },
  viridis: {
    id: "viridis",
    label: "Blue (ethereal)",
    // Amplitude-based ethereal blue colormap: deep navy background
    // fading into bright, misty blues for large |ψ|.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      let t = Math.sqrt(amp2);
      if (!Number.isFinite(t)) t = 0;
      t = Math.max(0, Math.min(1, t));

      const stops = [
        { r: 2, g: 6, b: 23 },      // #020617 – almost black navy
        { r: 15, g: 23, b: 42 },    // #0f172a – deep slate-blue
        { r: 37, g: 99, b: 235 },   // #2563eb – rich blue
        { r: 56, g: 189, b: 248 },  // #38bdf8 – bright cyan-blue
        { r: 224, g: 242, b: 254 }, // #e0f2fe – pale ethereal highlight
      ];

      const scaled = t * (stops.length - 1);
      const idx = Math.max(
        0,
        Math.min(stops.length - 2, Math.floor(scaled))
      );
      const localT = scaled - idx;
      const c0 = stops[idx];
      const c1 = stops[idx + 1];

      const r = Math.round(c0.r + (c1.r - c0.r) * localT);
      const g = Math.round(c0.g + (c1.g - c0.g) * localT);
      const b = Math.round(c0.b + (c1.b - c0.b) * localT);

      return [r, g, b, Math.round(alpha * 255)];
    },
  },
  blueRed: {
    id: "blueRed",
    label: "Blue–Red",
    // Diverging colormap with periodic phase boundaries: red and blue peaks
    // occur at opposite phases and smoothly converge to a green midpoint
    // at both angle = 0 and angle = ±π.
    map(re, im) {
      const amp2 = re * re + im * im;
      if (!Number.isFinite(amp2) || amp2 <= 0) {
        return [0, 0, 0, 0];
      }

      const alpha = Math.max(0, Math.min(1, amp2));
      const angle = Math.atan2(im, re);
      let u = (angle + Math.PI) / (2 * Math.PI); // [0,1) before wrap
      if (!Number.isFinite(u)) u = 0;
      u = u - Math.floor(u); // enforce wrap to [0,1)

      const red = { r: 220, g: 38, b: 38 };   // #dc2626
      const green = { r: 34, g: 197, b: 94 }; // #22c55e
      const blue = { r: 37, g: 99, b: 235 };  // #2563eb

      let c0, c1, localT;
      if (u < 1 / 3) {
        localT = u * 3; // 0..1 across red -> green
        c0 = red;
        c1 = green;
      } else if (u < 2 / 3) {
        localT = (u - 1 / 3) * 3; // 0..1 across green -> blue
        c0 = green;
        c1 = blue;
      } else {
        localT = (u - 2 / 3) * 3; // 0..1 across blue -> red for periodic wrap
        c0 = blue;
        c1 = red;
      }

      const r = Math.round(c0.r + (c1.r - c0.r) * localT);
      const g = Math.round(c0.g + (c1.g - c0.g) * localT);
      const b = Math.round(c0.b + (c1.b - c0.b) * localT);

      return [r, g, b, Math.round(alpha * 255)];
    },
  },
};

let activeColorSchemeId = "phase";

function getActiveColorScheme() {
  const scheme = COMPLEX_COLOR_SCHEMES[activeColorSchemeId];
  return scheme || COMPLEX_COLOR_SCHEMES.phase;
}

// Primary entry point for mapping ψ to color; uses the active scheme.
function complexToRGBA(re, im) {
  const scheme = getActiveColorScheme();
  return scheme.map(re, im);
}

function normalizeWavefunctionToUnitNorm() {
  if (!psiRe || !psiIm || !canvas) return;

  const width = canvas.width;
  const scalePos = (BASE_SCALE_POS * width) / BASE_RESOLUTION;
  const dA = 1 / (scalePos * scalePos);

  const n = psiRe.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const re = psiRe[i], im = psiIm[i];
    sum += re * re + im * im;
  }

  // physical norm: Σ |ψ|^2 dA
  const norm = sum * dA;
  if (!Number.isFinite(norm) || norm <= 0) return;

  const factor = 1 / Math.sqrt(norm);
  for (let i = 0; i < n; i++) {
    psiRe[i] *= factor;
    psiIm[i] *= factor;
  }

  currentNormFactor = 1;
}

function updatePlotScaleFromCurrentPsi() {
  if (!psiRe || !psiIm) return;
  const n = Math.min(psiRe.length, psiIm.length);
  if (!Number.isFinite(n) || n <= 0) return;

  let maxAmp = 0;
  for (let i = 0; i < n; i++) {
    const re = psiRe[i];
    const im = psiIm[i];
    const amp = Math.hypot(re, im);
    if (amp > maxAmp) {
      maxAmp = amp;
    }
  }

  plotScaleFactor = maxAmp > 0 && Number.isFinite(maxAmp) ? 1 / maxAmp : 1;
}

function drawScene() {
  if (!canvas || !ctx || !psiRe || !psiIm) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  if (initialPsiDirty && !isPlaying) {
    resetWavefunctionFromControls();
  }

  if (showEnergy) {
    const E = computeEnergyExpectation();
    if (Number.isFinite(E)) {
      lastEnergyValue = E;
    } else {
      lastEnergyValue = null;
    }
  }

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  const total = width * height;

  const plotScale =
    typeof plotScaleFactor === "number" && Number.isFinite(plotScaleFactor)
      ? plotScaleFactor
      : 1;

  for (let idx = 0; idx < total; idx++) {
    const re = psiRe[idx] * plotScale;
    const im = psiIm[idx] * plotScale;
    const [r, g, b, a] = complexToRGBA(re, im);

    const base = idx * 4;
    data[base] = r;
    data[base + 1] = g;
    data[base + 2] = b;
    data[base + 3] = a;
  }

  ctx.putImageData(imageData, 0, 0);

  // Draw overlays (colorbar, energy, signature) on the high-resolution layer.
  if (typeof drawOverlayLayer === "function") {
    drawOverlayLayer();
  }

  // Keep the Picture-in-Picture output canvas in sync when active.
  if (typeof updateCombinedCanvasForPip === "function") {
    updateCombinedCanvasForPip();
  }
}

function resetWavefunctionFromControls() {
  if (!psiRe || !psiIm || !canvas) return;

  const state = getControlsState();

  const mu_x = state.x;
  const mu_y = state.y;
  const mu_px =
    typeof displayMomentumToInternal === "function"
      ? displayMomentumToInternal(state.px)
      : state.px;
  const mu_py =
    typeof displayMomentumToInternal === "function"
      ? displayMomentumToInternal(state.py)
      : state.py;

  let sigma = state.sigmaX;
  if (!Number.isFinite(sigma) || sigma <= 0) {
    sigma = 1e-6;
  }

  const width = canvas.width;
  const height = canvas.height;
  const centerX = width / 2;
  const centerY = height / 2;
  const scalePos = (BASE_SCALE_POS * width) / BASE_RESOLUTION; // pixels per unit, scaled with resolution

  const total = width * height;
  if (psiRe.length !== total || psiIm.length !== total) {
    initSimulationGrid(width, height);
  }

  let idx = 0;
  for (let j = 0; j < height; j++) {
    const yCoord = (centerY - j) / scalePos;
    for (let i = 0; i < width; i++) {
      const xCoord = (i - centerX) / scalePos;

      const psiVal = phi(xCoord, yCoord, mu_x, mu_y, sigma, sigma, mu_px, mu_py);

      if (idx === 0 && psiVal && typeof psiVal.normFactor === "number") {
        currentNormFactor = psiVal.normFactor;
      }

      psiRe[idx] = psiVal.re;
      psiIm[idx] = psiVal.im;
      idx++;
    }
  }

  // Normalize the constructed wave-packet so that it has unit norm
  // by default, independent of the optional rescaling mode.
  normalizeWavefunctionToUnitNorm();
  updatePlotScaleFromCurrentPsi();

  initialPsiDirty = false;
  wavefunctionCanBeReconstructedFromControls = true;
  console.log("[Schrödinger] Initial wavefunction reset from controls");
  updateParticleOverlay();
}

function stepSchrodingerEuler() {
  if (!psiRe || !psiIm || !psiReNext || !psiImNext) return;
  if (!canvas) return;

  const width = canvas.width;
  const height = canvas.height;

  if (simWidth !== width || simHeight !== height) {
    initSimulationGrid(width, height);
    resetWavefunctionFromControls();
  }

  const w = width;
  const h = height;

  const hasPotential = !!potentialField && potentialWidth > 0 && potentialHeight > 0;

  // Neumann (open) boundary conditions implemented via mirrored neighbors.
  for (let y = 0; y < h; y++) {
    const yUp = y === 0 ? 0 : y - 1;
    const yDown = y === h - 1 ? h - 1 : y + 1;
    for (let x = 0; x < w; x++) {
      const xLeft = x === 0 ? 0 : x - 1;
      const xRight = x === w - 1 ? w - 1 : x + 1;

      const idx = y * w + x;
      const idxL = y * w + xLeft;
      const idxR = y * w + xRight;
      const idxU = yUp * w + x;
      const idxD = yDown * w + x;
      const idxUL = yUp * w + xLeft;
      const idxUR = yUp * w + xRight;
      const idxDL = yDown * w + xLeft;
      const idxDR = yDown * w + xRight;

      const re = psiRe[idx];
      const im = psiIm[idx];

      const lapRe =
        (4 *
          (psiRe[idxL] + psiRe[idxR] + psiRe[idxU] + psiRe[idxD]) +
          (psiRe[idxUL] + psiRe[idxUR] + psiRe[idxDL] + psiRe[idxDR]) -
          20 * re) /
        6;
      const lapIm =
        (4 *
          (psiIm[idxL] + psiIm[idxR] + psiIm[idxU] + psiIm[idxD]) +
          (psiIm[idxUL] + psiIm[idxUR] + psiIm[idxDL] + psiIm[idxDR]) -
          20 * im) /
        6;

      let V = 0;
      if (hasPotential) {
        const xp =
          Math.max(
            0,
            Math.min(potentialWidth - 1, Math.round((x * potentialWidth) / w))
          );
        const yp =
          Math.max(
            0,
            Math.min(potentialHeight - 1, Math.round((y * potentialHeight) / h))
          );
        const idxP = yp * potentialWidth + xp;
        V = (potentialField[idxP] || 0) * POTENTIAL_SCALE;
      }

      let dRe;
      let dIm;

      // Real-time Schrödinger: i ∂ψ/∂t = (-½∇² + V) ψ
      // Imaginary-time Schrödinger: ∂ψ/∂τ = -( -½∇² + V ) ψ
      if (typeof isImaginaryTime !== "undefined" && isImaginaryTime) {
        // dψ/dτ = -Hψ with H = -½∇² + V  ⇒
        // dRe/dτ = +½ ∇² Re - V Re
        // dIm/dτ = +½ ∇² Im - V Im
        dRe =  0.5 * lapRe - V * re;
        dIm =  0.5 * lapIm - V * im;
      } else {
        dRe = -0.5 * lapIm + V * im;
        dIm =  0.5 * lapRe - V * re;
      }

      let newRe = re + currentTimeStep * dRe;
      let newIm = im + currentTimeStep * dIm;

      // Smooth imaginary absorbing potential near the boundaries (open BC)
      if (ABSORB_LAYERS > 0 && boundaryMode === "open") {
        const distX = Math.min(x, w - 1 - x);
        const distY = Math.min(y, h - 1 - y);
        const dist = Math.min(distX, distY);
        if (dist < ABSORB_LAYERS) {
          const s = (ABSORB_LAYERS - dist) / ABSORB_LAYERS; // 0 at interior, 1 at edge
          const absorb = ABSORB_MAX * s * s;
          const factor = Math.exp(-absorb * currentTimeStep);
          newRe *= factor;
          newIm *= factor;
        }
      }

      psiReNext[idx] = newRe;
      psiImNext[idx] = newIm;
    }
  }

  const tmpRe = psiRe;
  psiRe = psiReNext;
  psiReNext = tmpRe;

  const tmpIm = psiIm;
  psiIm = psiImNext;
  psiImNext = tmpIm;

  simTime += currentTimeStep;
}

function stepSchrodingerCrankNicolsonFixedPointIters() {
  if (!psiRe || !psiIm || !psiReNext || !psiImNext) return;
  if (!canvas) return;

  const width = canvas.width;
  const height = canvas.height;

  if (simWidth !== width || simHeight !== height) {
    initSimulationGrid(width, height);
    resetWavefunctionFromControls();
  }

  const w = width;
  const h = height;
  const N = w * h;
  const dt = currentTimeStep;

  const hasPotential = !!potentialField && potentialWidth > 0 && potentialHeight > 0;

  // Right-hand side for (I - dt/2 * L) psi^{n+1} = psi^n + dt/2 * L psi^n,
  // where L is the real- or imaginary-time Schrödinger operator depending
  // on the isImaginaryTime flag. Reuse module-level buffers to avoid
  // per-step allocations; resize only when the simulation grid size N changes.
  if (!cnRhsRe || cnRhsRe.length !== N) {
    cnRhsRe = new Float32Array(N);
  }
  if (!cnRhsIm || cnRhsIm.length !== N) {
    cnRhsIm = new Float32Array(N);
  }
  const rhsRe = cnRhsRe;
  const rhsIm = cnRhsIm;

  // --- 1) Build RHS using the OLD wavefunction (explicit part) ---
  for (let y = 0; y < h; y++) {
    const yUp = y === 0 ? 0 : y - 1;
    const yDown = y === h - 1 ? h - 1 : y + 1;
    for (let x = 0; x < w; x++) {
      const xLeft = x === 0 ? 0 : x - 1;
      const xRight = x === w - 1 ? w - 1 : x + 1;

      const idx = y * w + x;
      const idxL = y * w + xLeft;
      const idxR = y * w + xRight;
      const idxU = yUp * w + x;
      const idxD = yDown * w + x;
      const idxUL = yUp * w + xLeft;
      const idxUR = yUp * w + xRight;
      const idxDL = yDown * w + xLeft;
      const idxDR = yDown * w + xRight;

      const re = psiRe[idx];
      const im = psiIm[idx];

      const lapRe =
        (4 *
          (psiRe[idxL] + psiRe[idxR] + psiRe[idxU] + psiRe[idxD]) +
          (psiRe[idxUL] + psiRe[idxUR] + psiRe[idxDL] + psiRe[idxDR]) -
          20 * re) /
        6;
      const lapIm =
        (4 *
          (psiIm[idxL] + psiIm[idxR] + psiIm[idxU] + psiIm[idxD]) +
          (psiIm[idxUL] + psiIm[idxUR] + psiIm[idxDL] + psiIm[idxDR]) -
          20 * im) /
        6;

      let V = 0;
      if (hasPotential) {
        const xp = Math.max(
          0,
          Math.min(potentialWidth - 1, Math.round((x * potentialWidth) / w))
        );
        const yp = Math.max(
          0,
          Math.min(potentialHeight - 1, Math.round((y * potentialHeight) / h))
        );
        const idxP = yp * potentialWidth + xp;
        V = (potentialField[idxP] || 0) * POTENTIAL_SCALE;
      }

      let dRe;
      let dIm;
      if (typeof isImaginaryTime !== "undefined" && isImaginaryTime) {
        // Imaginary-time Schrödinger: ∂ψ/∂τ = -( -½∇² + V ) ψ
        // dRe/dτ = +½ ∇² Re - V Re, dIm/dτ = +½ ∇² Im - V Im.
        dRe = 0.5 * lapRe - V * re;
        dIm = 0.5 * lapIm - V * im;
      } else {
        // Real-time Schrödinger: i ∂ψ/∂t = (-½∇² + V) ψ.
        dRe = -0.5 * lapIm + V * im;
        dIm = 0.5 * lapRe - V * re;
      }

      rhsRe[idx] = re + 0.5 * dt * dRe;
      rhsIm[idx] = im + 0.5 * dt * dIm;
    }
  }

  // --- 2) Implicit part: fixed-point solve of
  //       (I - dt/2 * L) psi^{n+1} = rhs
  //
  // We keep the current guess in psiRe / psiIm,
  // and write updated guesses into psiReNext / psiImNext.

  // Initial guess for psi^{n+1}: start from old wavefunction
  // (you can also start from rhsRe / rhsIm, but this is fine).
  // psiRe, psiIm already hold old ψ^n.

  for (let iter = 0; iter < CN_ITERS; iter++) {
    for (let y = 0; y < h; y++) {
      const yUp = y === 0 ? 0 : y - 1;
      const yDown = y === h - 1 ? h - 1 : y + 1;
      for (let x = 0; x < w; x++) {
        const xLeft = x === 0 ? 0 : x - 1;
        const xRight = x === w - 1 ? w - 1 : x + 1;

        const idx = y * w + x;
        const idxL = y * w + xLeft;
        const idxR = y * w + xRight;
        const idxU = yUp * w + x;
        const idxD = yDown * w + x;
        const idxUL = yUp * w + xLeft;
        const idxUR = yUp * w + xRight;
        const idxDL = yDown * w + xLeft;
        const idxDR = yDown * w + xRight;

        const re = psiRe[idx];
        const im = psiIm[idx];

        const lapRe =
          (4 *
            (psiRe[idxL] + psiRe[idxR] + psiRe[idxU] + psiRe[idxD]) +
            (psiRe[idxUL] + psiRe[idxUR] + psiRe[idxDL] + psiRe[idxDR]) -
            20 * re) /
          6;
        const lapIm =
          (4 *
            (psiIm[idxL] + psiIm[idxR] + psiIm[idxU] + psiIm[idxD]) +
            (psiIm[idxUL] + psiIm[idxUR] + psiIm[idxDL] + psiIm[idxDR]) -
            20 * im) /
          6;

        let V = 0;
        if (hasPotential) {
          const xp = Math.max(
            0,
            Math.min(potentialWidth - 1, Math.round((x * potentialWidth) / w))
          );
          const yp = Math.max(
            0,
            Math.min(potentialHeight - 1, Math.round((y * potentialHeight) / h))
          );
          const idxP = yp * potentialWidth + xp;
          V = (potentialField[idxP] || 0) * POTENTIAL_SCALE;
        }

        let dRe;
        let dIm;
        if (typeof isImaginaryTime !== "undefined" && isImaginaryTime) {
          dRe = 0.5 * lapRe - V * re;
          dIm = 0.5 * lapIm - V * im;
        } else {
          dRe = -0.5 * lapIm + V * im;
          dIm = 0.5 * lapRe - V * re;
        }

        // Fixed-point update: psi_new = rhs + dt/2 * L(psi_new_guess)
        const newRe = rhsRe[idx] + 0.5 * dt * dRe;
        const newIm = rhsIm[idx] + 0.5 * dt * dIm;

        psiReNext[idx] = newRe;
        psiImNext[idx] = newIm;
      }
    }

    // Prepare for next iteration: new guess becomes current
    if (iter < CN_ITERS - 1) {
      let tmpRe = psiRe;
      psiRe = psiReNext;
      psiReNext = tmpRe;

      let tmpIm = psiIm;
      psiIm = psiImNext;
      psiImNext = tmpIm;
    }
  }

  // After the loop, psiReNext / psiImNext hold the final CN result.

  // --- 3) Apply absorbing boundaries to the new wavefunction (open BC) ---
  if (ABSORB_LAYERS > 0 && boundaryMode === "open") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;

        const distX = Math.min(x, w - 1 - x);
        const distY = Math.min(y, h - 1 - y);
        const dist = Math.min(distX, distY);

        if (dist < ABSORB_LAYERS) {
          const s = (ABSORB_LAYERS - dist) / ABSORB_LAYERS; // 0 in interior, 1 at edge
          const absorb = ABSORB_MAX * s * s;
          const factor = Math.exp(-absorb * dt);
          psiReNext[idx] *= factor;
          psiImNext[idx] *= factor;
        }
      }
    }
  }

  // --- 4) Swap buffers so psiRe / psiIm hold the new wavefunction ---
  let tmpRe = psiRe;
  psiRe = psiReNext;
  psiReNext = tmpRe;

  let tmpIm = psiIm;
  psiIm = psiImNext;
  psiImNext = tmpIm;

  simTime += dt;
}

function rescaleWavefunctionIfNeeded() {
  if (!psiRe || !psiIm) return;
  if (typeof psiRescaleMode === "undefined" || psiRescaleMode === "none") {
    return;
  }

  const n = psiRe.length;
  if (!Number.isFinite(n) || n <= 0) return;

  if (psiRescaleMode === "norm") {
    // Reuse the existing normalization helper so that the
    // norm is computed consistently with the rest of the code
    // (including the spatial area element).
    if (typeof normalizeWavefunctionToUnitNorm === "function") {
      normalizeWavefunctionToUnitNorm();
    }
  } else if (psiRescaleMode === "max") {
    let maxAmp2 = 0;
    for (let i = 0; i < n; i++) {
      const re = psiRe[i];
      const im = psiIm[i];
      const amp2 = re * re + im * im;
      if (amp2 > maxAmp2) {
        maxAmp2 = amp2;
      }
    }
    if (!Number.isFinite(maxAmp2) || maxAmp2 <= 0) return;
    const factor = 1 / Math.sqrt(maxAmp2);
    for (let i = 0; i < n; i++) {
      psiRe[i] *= factor;
      psiIm[i] *= factor;
    }
  }
}

function stepSchrodinger() {
  // Use the integrator selected in the UI for both real-time and
  // imaginary-time evolution. The underlying step functions switch
  // between real and imaginary dynamics based on isImaginaryTime.
  wavefunctionCanBeReconstructedFromControls = false;
  const scheme =
    typeof integratorScheme === "string" ? integratorScheme : "crank";
  if (scheme === "euler") {
    stepSchrodingerEuler();
  } else {
    stepSchrodingerCrankNicolsonFixedPointIters();
  }

  if (
    typeof psiRescaleMode !== "undefined" &&
    psiRescaleMode !== "none"
  ) {
    rescaleWavefunctionIfNeeded();
  }
}

function computeEnergyExpectation() {
  if (!psiRe || !psiIm || !canvas) return null;

  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return null;

  const w = width;
  const h = height;

  // Spatial scale: pixels per simulation unit (same as in resetWavefunctionFromControls).
  const scalePos = (BASE_SCALE_POS * width) / BASE_RESOLUTION;
  const hasPotential =
    !!potentialField && potentialWidth > 0 && potentialHeight > 0;

  let energy = 0;

  for (let y = 0; y < h; y++) {
    const yDown = y === h - 1 ? h - 1 : y + 1;
    for (let x = 0; x < w; x++) {
      const xRight = x === w - 1 ? w - 1 : x + 1;

      const idx = y * w + x;
      const idxR = y * w + xRight;
      const idxD = yDown * w + x;

      const re = psiRe[idx];
      const im = psiIm[idx];

      const reR = psiRe[idxR];
      const imR = psiIm[idxR];
      const reD = psiRe[idxD];
      const imD = psiIm[idxD];

      const dxRe = reR - re;
      const dxIm = imR - im;
      const dyRe = reD - re;
      const dyIm = imD - im;

      const grad2 = dxRe * dxRe + dxIm * dxIm + dyRe * dyRe + dyIm * dyIm;
      const kinetic = 0.5 * grad2;

      let V = 0;
      if (hasPotential) {
        const xp = Math.max(
          0,
          Math.min(
            potentialWidth - 1,
            Math.round((x * potentialWidth) / w)
          )
        );
        const yp = Math.max(
          0,
          Math.min(
            potentialHeight - 1,
            Math.round((y * potentialHeight) / h)
          )
        );
        const idxP = yp * potentialWidth + xp;
        V = (potentialField[idxP] || 0) * POTENTIAL_SCALE;
      }

      const density = re * re + im * im;
      energy += kinetic + V * density;
    }
  }

  // Divide by scalePos^2 to account for discretization of the spatial grid.
  return energy / (scalePos * scalePos);
}

function drawPotentialColorbar(ctx, width, height) {
  const barWidth = Math.max(15, Math.round(width * 0.03));
  const barHeight = Math.max(75, Math.round(width * 0.12));
  const x0 = 10;
  const y0 = 10;

  // Compute min/max physical potential values for mapping.
  const range = getPotentialRange();
  const minV = range.minV;
  const maxV = range.maxV;

  const minLabel = minV.toFixed(1);
  const maxLabel = maxV.toFixed(1);

  ctx.save();

  const gradient = ctx.createLinearGradient(0, y0 + barHeight, 0, y0);
  gradient.addColorStop(0, "rgba(0, 0, 0, 1)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 1)");

  // Match the overlay energy text size for consistent typography.
  ctx.font = "24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const vLabel = "V";

  ctx.fillStyle = gradient;
  ctx.fillRect(x0, y0, barWidth, barHeight);

  // Thin black outline plus green accent border for the colorbar.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.strokeRect(x0, y0, barWidth, barHeight);

  ctx.lineWidth = 1;
  ctx.strokeStyle = OVERLAY_ACCENT_COLOR;
  ctx.strokeRect(x0, y0, barWidth, barHeight);

  // Text with black outline and green fill.
  ctx.fillStyle = OVERLAY_ACCENT_COLOR;
  // Draw the "V" label centered horizontally under the colorbar.
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const vX = x0 + barWidth / 2;
  const vY = y0 + barHeight + 6;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(vLabel, vX, vY);
  ctx.fillText(vLabel, vX, vY);

  // Numeric labels to the right of the bar.
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const textX = x0 + barWidth + 8;
  const yMax = y0 + 4;
  const yMin = y0 + barHeight - 4;
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(maxLabel, textX, yMax);
  ctx.fillText(maxLabel, textX, yMax);
  ctx.strokeText(minLabel, textX, yMin);
  ctx.fillText(minLabel, textX, yMin);

  ctx.restore();
}

function drawEnergyOverlay(ctx, width, height, energyValue) {
  const margin = 10;
  const text =
    "E = " +
    (Number.isFinite(energyValue) ? energyValue.toPrecision(2) : "—");

  ctx.save();
  ctx.font = "24px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  const xRight = width - margin;
  const yTop = margin;

  // Thin black outline plus green fill for the energy text.
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(text, xRight, yTop);

  ctx.fillStyle = OVERLAY_ACCENT_COLOR;
  ctx.fillText(text, xRight, yTop);

  ctx.restore();
}

function drawPhaseCircle(ctx, width, height) {
  const margin = 10;
  const radius = Math.max(24, Math.round(Math.min(width, height) * 0.06));
  const centerX = radius + margin;
  const centerY = height - radius - margin;
  const size = radius * 2;
  const maxRadius = radius + 0.5;
  const maxRadiusSq = maxRadius * maxRadius;

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  let idx = 0;
  for (let j = 0; j < size; j++) {
    // Canvas y increases downward; flip sign so positive imaginary
    // axis points upward in the phase diagram.
    const dy = j - radius;
    for (let i = 0; i < size; i++) {
      const dx = i - radius;
      const r2 = dx * dx + dy * dy;

      if (r2 <= maxRadiusSq) {
        const xNorm = dx / radius;
        const yNorm = -dy / radius;
        const [r, g, b, a] = complexToRGBA(xNorm, yNorm);

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a;
      } else {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }

      idx += 4;
    }
  }

  ctx.save();
  ctx.putImageData(imageData, centerX - radius, centerY - radius);

  // Accent outline around the phase circle.
  ctx.lineWidth = 2;
  ctx.strokeStyle = OVERLAY_ACCENT_COLOR;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 0.5, 0, 2 * Math.PI);
  ctx.stroke();

  // Label Ψ in the center of the circle.
  ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = "Ψ";
  const textX = centerX;
  const textY = centerY;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(label, textX, textY);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, textX, textY);

  ctx.restore();
}

function drawOverlayLayer() {
  if (!overlayCanvas || !overlayCtx) return;

  // Draw overlays in the overlay canvas' own coordinate system so sizes
  // remain consistent regardless of simulation resolution.
  const baseWidth = overlayCanvas.width;
  const baseHeight = overlayCanvas.height;

  // Reset to identity to clear the full device-sized canvas.
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // No additional scaling: draw directly in overlay pixel space.
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);

  if (showColorbar) {
    drawPotentialColorbar(overlayCtx, baseWidth, baseHeight);
  }

  if (showEnergy && lastEnergyValue !== null) {
    drawEnergyOverlay(overlayCtx, baseWidth, baseHeight, lastEnergyValue);
  }

  if (showPhaseCircle) {
    drawPhaseCircle(overlayCtx, baseWidth, baseHeight);
  }
}

function animationLoop() {
  if (isPlaying) {
    if (initialPsiDirty) {
      resetWavefunctionFromControls();
    }
    // Take several small steps per frame for smoother evolution
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      stepSchrodinger();
      frameCount += 1;
    }

    const now = performance.now();
    if (!lastLogTime || now - lastLogTime > 1000) {
      console.log(
        `[Schrödinger] t = ${simTime.toFixed(3)}, frames = ${frameCount}`
      );
      lastLogTime = now;
    }

    drawScene();

    // If recording is enabled, capture a combined potential+quantum frame.
    if (typeof recordFrameIfNeeded === "function") {
      recordFrameIfNeeded();
    }
  }

  animationFrameId = window.requestAnimationFrame(animationLoop);
}
