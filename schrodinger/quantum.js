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

// Time evolution state
let isPlaying = false;
let animationFrameId = null;

let initialPsiDirty = true;

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

// Analytic normalization factor returned by phi for the current
// initial wavefunction shape (independent of x, y).
let currentNormFactor = 1;

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
}

function initSimulationGrid(width, height) {
  simWidth = width;
  simHeight = height;
  psiRe = new Float32Array(width * height);
  psiIm = new Float32Array(width * height);
  psiReNext = new Float32Array(width * height);
  psiImNext = new Float32Array(width * height);
  initialPsiDirty = true;
}

function markInitialPsiDirty() {
  if (!isPlaying) {
    initialPsiDirty = true;
  }
}

// Map complex value (re, im) to RGBA using amplitude for alpha
// and argument for a rainbow hue.
function complexToRGBA(re, im) {
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
  for (let idx = 0; idx < total; idx++) {
    const re = psiRe[idx];
    const im = psiIm[idx];
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

  initialPsiDirty = false;
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

      const re = psiRe[idx];
      const im = psiIm[idx];

      const lapRe =
        psiRe[idxL] + psiRe[idxR] + psiRe[idxU] + psiRe[idxD] - 4 * re;
      const lapIm =
        psiIm[idxL] + psiIm[idxR] + psiIm[idxU] + psiIm[idxD] - 4 * im;

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

      const dRe = -0.5 * lapIm + V * im;
      const dIm =  0.5 * lapRe - V * re;

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

  // Right-hand side for (I - dt/2 * L) psi^{n+1} = psi^n + dt/2 * L psi^n
  const rhsRe = new Float32Array(N);
  const rhsIm = new Float32Array(N);

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

      const re = psiRe[idx];
      const im = psiIm[idx];

      const lapRe =
        psiRe[idxL] + psiRe[idxR] + psiRe[idxU] + psiRe[idxD] - 4 * re;
      const lapIm =
        psiIm[idxL] + psiIm[idxR] + psiIm[idxU] + psiIm[idxD] - 4 * im;

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

      // Correct sign for Schrödinger: i dψ/dt = (-½∇² + V) ψ
      const dRe = -0.5 * lapIm + V * im;
      const dIm =  0.5 * lapRe - V * re;

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

        const re = psiRe[idx];
        const im = psiIm[idx];

        const lapRe =
          psiRe[idxL] + psiRe[idxR] + psiRe[idxU] + psiRe[idxD] - 4 * re;
        const lapIm =
          psiIm[idxL] + psiIm[idxR] + psiIm[idxU] + psiIm[idxD] - 4 * im;

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

        const dRe = -0.5 * lapIm + V * im;
        const dIm =  0.5 * lapRe - V * re;

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

function stepSchrodinger() {
  // You can switch between different stepping methods here.
  //stepSchrodingerEuler();
  stepSchrodingerCrankNicolsonFixedPointIters();
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

  const normalizationScale =
    typeof currentNormFactor === "number" && Number.isFinite(currentNormFactor)
      ? currentNormFactor * currentNormFactor
      : 1;

  // Divide by scalePos^2 to account for discretization of the spatial grid.
  return (energy * normalizationScale) / (scalePos * scalePos);
}

function drawPotentialColorbar(ctx, width, height) {
  const barWidth = Math.max(10, Math.round(width * 0.02));
  const barHeight = Math.max(50, Math.round(height * 0.2));
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

  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
    (Number.isFinite(energyValue) ? energyValue.toFixed(2) : "—");

  ctx.save();
  ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";

  const xRight = width - margin;
  const yTop = margin;

  // Thin black outline plus green fill for the energy text.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 1)";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.strokeText(text, xRight, yTop);

  ctx.fillStyle = OVERLAY_ACCENT_COLOR;
  ctx.fillText(text, xRight, yTop);

  ctx.restore();
}

function drawOverlayLayer() {
  if (!overlayCanvas || !overlayCtx) return;

  // Use the simulation grid dimensions for geometry; the overlay canvas
  // may be a supersampled version of this grid.
  const baseWidth =
    typeof currentResolutionWidth === "number" && currentResolutionWidth > 0
      ? currentResolutionWidth
      : overlayCanvas.width;
  const baseHeight =
    typeof currentResolutionHeight === "number" && currentResolutionHeight > 0
      ? currentResolutionHeight
      : overlayCanvas.height;

  // Reset to identity to clear the full device-sized canvas.
  overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // Scale drawing so that logical coordinates match the simulation grid.
  const scaleX = overlayCanvas.width / baseWidth;
  const scaleY = overlayCanvas.height / baseHeight;
  const scale = Math.min(scaleX || 1, scaleY || 1);
  overlayCtx.setTransform(scale, 0, 0, scale, 0, 0);

  if (showColorbar) {
    drawPotentialColorbar(overlayCtx, baseWidth, baseHeight);
  }

  if (showEnergy && lastEnergyValue !== null) {
    drawEnergyOverlay(overlayCtx, baseWidth, baseHeight, lastEnergyValue);
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
