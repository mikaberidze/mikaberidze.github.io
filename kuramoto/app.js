import { STEP, MAX_NETWORK_SIZE, sampleIndices, sizeLimit, edgeValue } from './sim-core.js';

const sizeInput = document.getElementById('size');
const densityInput = document.getElementById('density');
const meanInput = document.getElementById('mean');
const stdInput = document.getElementById('std');
const couplingInput = document.getElementById('coupling');
const sizeValue = document.getElementById('sizeValue');
const densityValue = document.getElementById('densityValue');
const meanValue = document.getElementById('meanValue');
const stdValue = document.getElementById('stdValue');
const couplingValue = document.getElementById('couplingValue');
const springCanvas = document.getElementById('springCanvas');
const circleCanvas = document.getElementById('circleCanvas');
const phaseCanvas = document.getElementById('phaseCanvas');
const kcCaption = document.getElementById('kcCaptionLatex');
const rebuildBtn = document.getElementById('rebuild');
const resetBtn = document.getElementById('resetPhases');
const clearHistoryBtn = document.getElementById('clearHistory');
const playbackButtons = Array.from(document.querySelectorAll('.playback-btn'));
const speedMultiplier = document.getElementById('speedMultiplier');
const rootStyles = getComputedStyle(document.documentElement);
const springBgColor = rootStyles.getPropertyValue('--panel') || rootStyles.getPropertyValue('--bg') || '#050c1d';
const orderColor = rootStyles.getPropertyValue('--accent').trim() || '#5af2c1';


const rateInput = document.getElementById('simRate');
const backendInput = document.getElementById('backend');
const engineStatus = document.getElementById('engineStatus');
const diagnostics = document.documentElement.dataset;
const maxNetworkSize = MAX_NETWORK_SIZE;
const geometry = { maxN: maxNetworkSize, positionSeed: 131071, edgeSeed: 196613,
  basePositions: { x: new Float32Array(maxNetworkSize), y: new Float32Array(maxNetworkSize) }, hasPositions: false };
const state = { n: 100, density: .05, mean: .5, std: 1, coupling: .5,
  phases: new Float32Array(100), freqs: new Float32Array(100),
  circleRadiusJitter: new Float32Array(100), layout: { x: [], y: [] },
  order: { r: 0, psi: 0 }, history: [], criticalK: 0, lastLog: 0 };
let indices = sampleIndices(100), networkIndices = indices;
let renderEdges = [], staticNetwork = null;
let needsLayout = true, resizeRequested = true, historyDirty = true;
let rebuildTimer, epoch = 0, control = 0, configured = false, inFlight = false;
let batchLimit = 16;
let pumpTimer = null, nextBatchAt = 0;
let lastStats = 0, measuredTime = 0;
let backendName = 'Starting', fallbackReason = '', notice = '';
const dimensions = new Map();
const playback = { speed: 0, step: .00064, max: .5 };
const worker = new Worker(new URL('./sim-worker.js', import.meta.url), { type: 'module' });

function updatePlaybackUI() {
  const speed = playback.speed;
  const activeMode = speed === 0 ? 'pause' : speed > 0 ? 'forward' : 'backward';
  playbackButtons.forEach(btn => {
    const mode = btn.dataset.mode;
    const isActive = mode === activeMode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  const multiplier = Math.round(speed / playback.step);
  speedMultiplier.textContent = `${multiplier}`;
}

function setPlaybackSpeed(value) {
  const snapped = Math.round(value / playback.step) * playback.step;
  const clamped = Math.max(-playback.max, Math.min(playback.max, snapped));
  playback.speed = Math.abs(clamped) < playback.step * 0.5 ? 0 : clamped;
  updatePlaybackUI();
}

function accelerateSpeed() {
  const currentMultiplier = Math.round(playback.speed / playback.step);
  const maxMultiplier = Math.round(playback.max / playback.step);
  const nextMultiplier = Math.min(maxMultiplier, currentMultiplier + 1);
  setPlaybackSpeed(nextMultiplier * playback.step);
}

function decelerateSpeed() {
  const currentMultiplier = Math.round(playback.speed / playback.step);
  const minMultiplier = -Math.round(playback.max / playback.step);
  const nextMultiplier = Math.max(minMultiplier, currentMultiplier - 1);
  setPlaybackSpeed(nextMultiplier * playback.step);
}


function createSeededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeed() {
  return (Math.random() * 0xffffffff) >>> 0 || 1;
}

function generateBasePositions() {
  const rng = createSeededRng(geometry.positionSeed);
  const px = geometry.basePositions.x;
  const py = geometry.basePositions.y;
  for (let i = 0; i < geometry.maxN; i++) {
    const r = Math.sqrt(rng());
    const theta = 2 * Math.PI * rng();
    px[i] = r * Math.cos(theta);
    py[i] = r * Math.sin(theta);
  }
  geometry.hasPositions = true;
}


function updateCriticalCaption() {
  if (!kcCaption) return;
  const kc = state.criticalK;
  const tex = `\\( K_c = 2 \\sigma_{\\omega} \\sqrt{2/\\pi} \\approx ${kc.toFixed(2)} \\)`;
  kcCaption.innerHTML = tex;
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([kcCaption]).catch(() => {});
  }
}

function computeCriticalK() {
  const sigma = Math.max(1e-3, state.std);
  state.criticalK = 2 * sigma * Math.sqrt(2 / Math.PI);
  updateCriticalCaption();
}


const delta_r = 0.1;

const freqColorStops = {
  low: { r: 31, g: 104, b: 249 },
  high: { r: 242, g: 90, b: 90 }
};

function freqColor(freq, minFreq, maxFreq, alpha = 1) {
  const spanFreq = maxFreq - minFreq;
  const t = spanFreq > 0 ? Math.min(1, Math.max(0, (freq - minFreq) / spanFreq)) : 0.5;
  const r = freqColorStops.low.r + (freqColorStops.high.r - freqColorStops.low.r) * t;
  const g = freqColorStops.low.g + (freqColorStops.high.g - freqColorStops.low.g) * t;
  const b = freqColorStops.low.b + (freqColorStops.high.b - freqColorStops.low.b) * t;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}


function resizeCanvases() {
  [springCanvas, circleCanvas, phaseCanvas].forEach(canvas => {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = canvas.getBoundingClientRect();
    dimensions.set(canvas, { width, height, ratio });
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    const ctx = canvas.getContext('2d');
    // Account for integer backing-buffer rounding independently on both axes.
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  });
  resizeRequested = false;
  needsLayout = true;
}

function computeLayout() {
  const n = Math.min(state.n, geometry.maxN);
  if (!n) return;
  const width = dimensions.get(springCanvas).width;
  const height = dimensions.get(springCanvas).height;
  if (!width || !height) return;
  if (!geometry.hasPositions) generateBasePositions();

  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const margin = 10;
  const innerW = Math.max(1, width - 2 * margin);
  const innerH = Math.max(1, height - 2 * margin);

  const cx = margin + innerW / 2;
  const cy = margin + innerH / 2;
  const rx = innerW / 2;
  const ry = innerH / 2;

  for (let i = 0; i < n; i++) {
    const xUnit = geometry.basePositions.x[i];
    const yUnit = geometry.basePositions.y[i];
    px[i] = cx + xUnit * rx;
    py[i] = cy + yUnit * ry;
  }

  state.layout.x = px;
  state.layout.y = py;
  cacheNetwork();
  historyDirty = true;
}


function drawCircle() {
  const ctx = circleCanvas.getContext('2d');
  const { width, height } = dimensions.get(circleCanvas);
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.37;

  // Unit circle
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * state.order.r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(90, 242, 193, 0.2)';
  ctx.stroke();
  ctx.setLineDash([]);

  // Nodes colored by frequency, with slight radial jitter
  const n = state.phases.length;
  const meanFreq = state.mean;
  const stdFreq = Math.max(1e-6, state.std);
  const minFreq = meanFreq - 2 * stdFreq;
  const maxFreq = meanFreq + 2 * stdFreq;

  for (const i of indices) {
    const phase = state.phases[i];
    const freq = state.freqs[i] ?? meanFreq;
    const jitter = state.circleRadiusJitter && state.circleRadiusJitter.length === n
      ? state.circleRadiusJitter[i]
      : 0;
    const nodeRadius = radius * (1 + jitter);
    const x = cx + nodeRadius * Math.cos(phase);
    const y = cy + nodeRadius * Math.sin(phase);
    ctx.fillStyle = freqColor(freq, minFreq, maxFreq, 1);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Order parameter vector
  const r = state.order.r;
  const psi = state.order.psi;
  const ox = cx + radius * r * Math.cos(psi);
  const oy = cy + radius * r * Math.sin(psi);

  ctx.strokeStyle = orderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ox, oy);
  ctx.stroke();
  ctx.fillStyle = orderColor;
  ctx.beginPath();
  ctx.arc(ox, oy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawPhasePlot() {
  const ctx = phaseCanvas.getContext('2d');
  const { width, height } = dimensions.get(phaseCanvas);
  ctx.clearRect(0, 0, width, height);
  const padLeft = 60;
  const padRight = 40;
  const padTop = 40;
  const padBottom = 52;
  const maxK = parseFloat(couplingInput.max);
  const xScale = k => padLeft + (k / maxK) * (width - padLeft - padRight);
  const yScale = r => height - padBottom - r * (height - padTop - padBottom);

  // Axes
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop - 8);
  ctx.lineTo(padLeft, height - padBottom);
  ctx.lineTo(width - padRight + 8, height - padBottom);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '12px "Avenir Next","Futura","Trebuchet MS",sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('K - coupling strength', width / 2, height - padBottom + 32);

  ctx.save();
  ctx.translate(padLeft - 40, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('r - order parameter', 0, 0);
  ctx.restore();
  ctx.textAlign = 'start';

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 5; i++) {
    const y = yScale(i / 5);
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
  }
  for (let i = 0; i <= 6; i++) {
    const x = xScale((i / 6) * maxK);
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, height - padBottom);
  }
  ctx.stroke();

  // X ticks
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  const tickStep = 0.5;
  for (let k = 0; k <= maxK + 1e-6; k += tickStep) {
    const x = xScale(k);
    ctx.beginPath();
    ctx.moveTo(x, height - padBottom);
    ctx.lineTo(x, height - padBottom + 6);
    ctx.stroke();
    ctx.fillText(k.toFixed(1), x - 8, height - padBottom + 18);
  }

  // Y ticks
  const yTickStep = 0.2;
  for (let r = 0; r <= 1 + 1e-6; r += yTickStep) {
    const y = yScale(r);
    ctx.beginPath();
    ctx.moveTo(padLeft - 6, y);
    ctx.lineTo(padLeft, y);
    ctx.stroke();
    ctx.fillText(r.toFixed(1), padLeft - 28, y + 4);
  }

  // Vertical critical line
  const kc = state.criticalK;
  if (kc <= maxK) {
    const kcX = xScale(kc);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(255,107,107,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(kcX, padTop);
    ctx.lineTo(kcX, height - padBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(255,107,107,0.9)';
    const kcLabel = `Kc ≈ ${kc.toFixed(2)}`;
    ctx.fillText(kcLabel, kcX + 6, padTop + 12);
  }

  // History scatter
  ctx.fillStyle = 'rgba(90, 242, 193, 0.08)';
  for (let i = 0; i < state.history.length; i++) {
    const { k, r } = state.history[i];
    const x = xScale(Math.min(maxK, k));
    const y = yScale(r);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Current point
  const xNow = xScale(state.coupling);
  const yNow = yScale(state.order.r);
  ctx.fillStyle = 'rgba(90, 242, 193, 0.9)';
  ctx.beginPath();
  ctx.arc(xNow, yNow, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(90, 242, 193, 0.6)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(xNow, yScale(0));
  ctx.lineTo(xNow, yNow);
  ctx.stroke();
}


function updateLabels() {
  sizeValue.textContent = Number(sizeInput.value).toLocaleString();
  densityValue.textContent = Number(densityInput.value).toFixed(2);
  meanValue.textContent = Number(meanInput.value).toFixed(2);
  stdValue.textContent = Number(stdInput.value).toFixed(2);
  couplingValue.textContent = state.coupling.toFixed(2);
}

function chooseDisplay(n) {
  indices = sampleIndices(n);
  networkIndices = Uint32Array.from({ length: Math.min(1000, indices.length) },
    (_, i) => indices[Math.floor(i * indices.length / Math.min(1000, indices.length))]);
  renderEdges = [];
  const rng = createSeededRng(geometry.edgeSeed), maxEdges = 4000;
  let found = 0;
  for (let a = 0; a < networkIndices.length; a++) {
    const i = networkIndices[a];
    for (let b = a + 1; b < networkIndices.length; b++) {
      const j = networkIndices[b];
      if (state.density === 1 || (state.density !== 0 && edgeValue(i, j, geometry.edgeSeed) <= state.density)) {
        found++;
        if (renderEdges.length < maxEdges) renderEdges.push([i, j]);
        else { const slot = Math.floor(rng() * found); if (slot < maxEdges) renderEdges[slot] = [i, j]; }
      }
    }
  }
  const jitter = createSeededRng(geometry.positionSeed);
  state.circleRadiusJitter = Float32Array.from({ length: n }, () => (jitter() * 2 - 1) * delta_r);
  diagnostics.drawnNodes = networkIndices.length;
  diagnostics.drawnEdges = renderEdges.length;
  diagnostics.phasePoints = indices.length;
}

function cacheNetwork() {
  const { width, height, ratio } = dimensions.get(springCanvas);
  staticNetwork = document.createElement('canvas');
  staticNetwork.width = springCanvas.width; staticNetwork.height = springCanvas.height;
  const ctx = staticNetwork.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const { x, y } = state.layout;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.beginPath();
  for (const [i, j] of renderEdges) { ctx.moveTo(x[i], y[i]); ctx.lineTo(x[j], y[j]); }
  ctx.stroke();
  ctx.lineWidth = .7; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.fillStyle = springBgColor.trim();
  for (const i of networkIndices) {
    ctx.beginPath(); ctx.arc(x[i], y[i], 6.45, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x[i], y[i], 5.25, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawSpring() {
  const ctx = springCanvas.getContext('2d'), { width, height } = dimensions.get(springCanvas);
  ctx.clearRect(0, 0, width, height);
  if (!staticNetwork) return;
  ctx.drawImage(staticNetwork, 0, 0, width, height);
  for (const i of networkIndices) {
    const phase = state.phases[i];
    ctx.fillStyle = `hsla(${phase / (Math.PI * 2) * 360},85%,65%,0.9)`;
    ctx.beginPath();
    ctx.arc(state.layout.x[i] + 5.25 * Math.cos(phase), state.layout.y[i] + 5.25 * Math.sin(phase), 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

let pendingConfig;
function configure({ reset = false, resetPhases = false } = {}) {
  clearTimeout(rebuildTimer);
  const density = Number(densityInput.value), limit = sizeLimit(density);
  const requestedN = Number(sizeInput.value);
  sizeInput.max = limit;
  sizeInput.value = Math.min(requestedN, limit);
  pendingConfig = { n: Number(sizeInput.value), density, mean: Number(meanInput.value),
    std: Number(stdInput.value), seed: geometry.edgeSeed, backend: backendInput.value, reset, resetPhases };
  configured = false; inFlight = false; epoch++;
  clearTimeout(pumpTimer); pumpTimer = null; nextBatchAt = 0;
  notice = ''; delete diagnostics.ready;
  engineStatus.textContent = 'Preparing…';
  updateLabels();
  worker.postMessage({ type: 'configure', epoch, config: pendingConfig });
}

function scheduleConfigure() {
  configured = false; epoch++;
  clearTimeout(pumpTimer); pumpTimer = null;
  delete diagnostics.ready;
  updateLabels(); engineStatus.textContent = 'Preparing…';
  clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => configure(), 140);
}

function receiveSnapshot(data) {
  for (let j = 0; j < indices.length; j++) state.phases[indices[j]] = data.phases[j];
  state.order = data.order; diagnostics.time = data.time; historyDirty = true;
}

worker.onmessage = ({ data }) => {
  if (data.epoch !== epoch) return;
  if (data.type === 'progress') {
    engineStatus.textContent = notice || `Building… ${Math.floor(data.progress * 100)}%`; return;
  }
  if (data.type === 'notice') { notice = data.text; return; }
  if (data.type === 'reduced') {
    configured = false; inFlight = false;
    clearTimeout(pumpTimer); pumpTimer = null; nextBatchAt = 0;
    delete diagnostics.ready;
    sizeInput.value = data.n; pendingConfig.n = data.n;
    notice = `Resource limit: N reduced from ${data.from.toLocaleString()} to ${data.n.toLocaleString()}.`;
    engineStatus.title = data.reason;
    updateLabels(); updateEngineStatus(); return;
  }
  if (data.type === 'error') {
    configured = false; inFlight = false;
    engineStatus.textContent = `Simulation stopped: ${data.text}. Change parameters to retry.`; return;
  }
  if (data.type === 'ready') {
    state.n = data.n; state.density = data.density;
    sizeInput.value = data.n; pendingConfig.n = data.n; updateLabels();
    diagnostics.n = data.n; diagnostics.device = data.backend; diagnostics.ready = 'true';
    state.mean = pendingConfig.mean; state.std = pendingConfig.std;
    state.phases = new Float32Array(state.n); state.freqs = new Float32Array(state.n);
    chooseDisplay(state.n);
    for (let j = 0; j < indices.length; j++) state.freqs[indices[j]] = data.freqs[j];
    receiveSnapshot(data); computeCriticalK(); needsLayout = true;
    state.history = []; state.lastLog = 0; measuredTime = data.time;
    backendName = data.backend; fallbackReason = data.reason;
    configured = true; inFlight = false;
    batchLimit = 16; lastStats = performance.now();
    updateEngineStatus(); pump(); render(); return;
  }
  if (data.type === 'frame') {
    inFlight = false;
    if (!configured) return;
    receiveSnapshot(data);
    if (data.control === control) {
      state.coupling = data.k; couplingInput.value = data.k;
      if ((data.k <= 0 && playback.speed < 0) || (data.k >= 3 && playback.speed > 0)) setPlaybackSpeed(0);
      updateLabels();
    }
    if (data.backend === 'WebGPU') {
      // Adapt to a short batch budget, including snapshot/dispatch overhead.
      const target = Math.max(1, Math.min(64, Math.floor(data.completed * 8 / Math.max(1, data.elapsed))));
      batchLimit = Math.max(1, Math.round(.5 * batchLimit + .5 * target));
    } else batchLimit = 64;
    const now = performance.now();
    if (now - state.lastLog >= 180) {
      state.history.push({ k: data.k, r: data.order.r }); state.lastLog = now;
      if (state.history.length > 2000) state.history.shift();
    }
    if (now - lastStats >= 1000) {
      diagnostics.throughput = ((data.time - measuredTime) * 1000 / (now - lastStats)).toFixed(1);
      measuredTime = data.time; lastStats = now;
    }
    // Submit first so the GPU can compute while Canvas draws this snapshot.
    pump(); render(); return;
  }
  if (data.type === 'recovery') {
    receiveSnapshot(data); state.history = []; measuredTime = 0; lastStats = performance.now();
    notice = data.text; backendName = data.backend; fallbackReason = ''; updateEngineStatus();
    inFlight = false; pump(); render();
  }
};
worker.onerror = event => {
  configured = false; inFlight = false;
  engineStatus.textContent = `Simulation worker failed: ${event.message || 'reload to retry'}`;
};

function updateEngineStatus() {
  engineStatus.textContent = notice || (fallbackReason ? 'GPU unavailable; using CPU.' : '');
  diagnostics.device = backendName;
}

function pump() {
  clearTimeout(pumpTimer); pumpTimer = null;
  if (!configured || Number(rateInput.value) === 0 || inFlight) return;
  const paced = rateInput.value === 'auto' && state.n < 2000;
  const now = performance.now();
  if (paced && now < nextBatchAt) {
    pumpTimer = setTimeout(pump, nextBatchAt - now);
    return;
  }
  // Small networks advance at most 2 simulated seconds per wall second, in
  // small visual increments. Larger networks submit immediately on completion.
  const steps = paced ? Math.min(batchLimit, 3) : batchLimit;
  nextBatchAt = paced ? now + steps * STEP / 2 * 1000 : 0;
  inFlight = true;
  const multiplier = Math.round(playback.speed / playback.step);
  const sweep = multiplier === 0 ? 0 : Math.sign(multiplier) * playback.step * Math.pow(1.5, Math.abs(multiplier));
  worker.postMessage({ type: 'run', epoch, steps, k: state.coupling, sweep, control });
}

function render() {
  if (resizeRequested) resizeCanvases();
  if (needsLayout) { computeLayout(); needsLayout = false; }
  drawSpring(); drawCircle();
  if (historyDirty) { drawPhasePlot(); historyDirty = false; }
}

function init() {
  generateBasePositions(); updateLabels(); computeCriticalK(); resizeCanvases();
  chooseDisplay(state.n); computeLayout(); needsLayout = false;
  window.addEventListener('resize', () => { resizeRequested = true; historyDirty = true; render(); });
  // Controls/status wrapping changes panel height without a window resize.
  // Keep the backing buffers in sync with their actual CSS sizes to prevent
  // the phase circle from being stretched by browser canvas resampling.
  const resizeObserver = new ResizeObserver(entries => {
    if (entries.some(({ target, contentRect }) => {
      const old = dimensions.get(target);
      return !old || Math.abs(old.width - contentRect.width) > .01 || Math.abs(old.height - contentRect.height) > .01;
    })) { resizeRequested = true; render(); }
  });
  [springCanvas, circleCanvas, phaseCanvas].forEach(canvas => resizeObserver.observe(canvas));
  [sizeInput, densityInput, meanInput, stdInput].forEach(input => input.addEventListener('input', scheduleConfigure));
  backendInput.addEventListener('change', () => configure());
  rateInput.addEventListener('change', () => {
    clearTimeout(pumpTimer); pumpTimer = null; nextBatchAt = 0;
    pump();
  });
  couplingInput.addEventListener('input', () => {
    state.coupling = Number(couplingInput.value); control++; setPlaybackSpeed(0);
    updateLabels(); historyDirty = true; render();
  });
  rebuildBtn.addEventListener('click', () => {
    geometry.positionSeed = makeSeed(); geometry.edgeSeed = makeSeed(); generateBasePositions();
    notice = ''; configure({ reset: true });
  });
  resetBtn.addEventListener('click', () => configure({ resetPhases: true }));
  clearHistoryBtn.addEventListener('click', () => { state.history = []; historyDirty = true; render(); });
  playbackButtons.forEach(btn => btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode === 'forward') setPlaybackSpeed(playback.step);
    else if (mode === 'backward') setPlaybackSpeed(-playback.step);
    else if (mode === 'pause') setPlaybackSpeed(0);
    else if (mode === 'accelerate') accelerateSpeed();
    else if (mode === 'decelerate') decelerateSpeed();
  }));
  setPlaybackSpeed(0); render(); configure();
}
init();
