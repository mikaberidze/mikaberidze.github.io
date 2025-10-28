// Character Network Viewer (refactored into ES modules)
import {
  getCurrentSummary,
  factsInRangeChar,
  getCurrentRel,
  factsInRangeInter,
  computeLayout,
  positionTooltip,
} from './js/utils.js';
import {
  sim,
  ensureNode,
  removeNode,
  ensureEdge,
  rebuildEdgeList,
  reheatSimulation,
  stepPhysics,
  updateSimBoundsFromStage,
} from './js/sim.js';
import {
  dom,
  initDomGraph,
  clearSVG,
  upsertNodeDom,
  deleteNodeDom,
  upsertEdgeDom,
  deleteEdgeDom,
  applyPositionsToDOM,
} from './js/domGraph.js';

const DATA_URL = './data/character_network.json';

const state = {
  data: null,
  N: 0,
  base: 0,
  startChunk: 0,
  chunk: 0,
  selectedId: null,
  selectedEdgeId: null,
  // Persist selection across temporary invisibility
  rememberedSelection: null, // { type: 'node'|'edge', id }
  layout: new Map(),
};

// Elements
const svg = document.getElementById('network');
const stage = document.getElementById('stage');
const sidebar = document.getElementById('sidebar');
const tooltip = document.getElementById('tooltip');
const mainLayout = document.getElementById('mainLayout');
const sourceBadge = document.createElement('div');
sourceBadge.id = 'sourceBadge';
Object.assign(sourceBadge.style, {
  position: 'absolute',
  top: '8px',
  left: '8px',
  background: 'rgba(17,24,39,0.85)',
  color: '#f9fafb',
  padding: '4px 8px',
  borderRadius: '6px',
  fontSize: '12px',
  lineHeight: '1',
  pointerEvents: 'auto',
  cursor: 'pointer',
  zIndex: 10,
});
stage.appendChild(sourceBadge);
sourceBadge.tabIndex = 0;
sourceBadge.setAttribute('role', 'button');
sourceBadge.setAttribute('aria-label', 'Open source text');
const openSourceText = () => {
  const chunk = (state.base || 0) + (state.startChunk || 0);
  // Open without bolding an active chunk
  openTextDock(chunk, { setActiveChunk: false });
};
sourceBadge.addEventListener('click', openSourceText);
sourceBadge.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    openSourceText();
  }
});
const rangeStart = document.getElementById('rangeStart');
const rangeEnd = document.getElementById('rangeEnd');
const rangeTrack = document.getElementById('rangeTrack');
const progressLabel = document.getElementById('progressLabel');
const sidebarHint = document.getElementById('sidebarHint');
const sidebarTitle = document.getElementById('sidebarTitle');
const charPanel = document.getElementById('charPanel');
const charHeader = document.getElementById('charHeader');
const charSummary = document.getElementById('charSummary');
const charStatus = document.getElementById('charStatus');
const eventList = document.getElementById('eventList');
const interPanel = document.getElementById('interPanel');
const interHeader = document.getElementById('interHeader');
const interSummary = document.getElementById('interSummary');
const interStatus = document.getElementById('interStatus');
const interEventList = document.getElementById('interEventList');
const textDock = document.getElementById('textDock');
const textFrame = document.getElementById('textFrame');
const textCloseBtn = document.getElementById('textCloseBtn');
const handleStageSidebar = document.getElementById('handleStageSidebar');
const handleDockStage = document.getElementById('handleDockStage');
// Chart containers
const charFactHistEl = document.getElementById('charFactHist');
const charInterHistEl = document.getElementById('charInterHist');
const interFactHistEl = document.getElementById('interFactHist');
const interSentChartEl = document.getElementById('interSentChart');

const PANE_PREF_KEY = 'booknetPanePrefs';
const DEFAULT_PANE_PREFS = { sidebar: 320, dock: 360 };
const panePrefs = loadPanePrefs();
let resizeRaf = null;
const resizeState = {
  type: null,
  pointerId: null,
  startX: 0,
  startSidebar: 0,
  startDock: 0,
  handle: null,
  prevUserSelect: '',
  prevCursor: '',
};
let resizeOverlay = null;

applyPaneWidths();
setupResizeHandles();

initDomGraph({ svg, stage, tooltip });

// -----------------------------
// Mini chart helpers (SVG)
// -----------------------------

function clearChart(el) {
  if (!el) return;
  el.innerHTML = '';
}

function ensureSize(el, fallbackWidth = 260, fallbackHeight = 84) {
  const w = Math.max(40, Math.floor(el?.clientWidth || fallbackWidth));
  const h = Math.max(40, Math.floor(el?.clientHeight || fallbackHeight));
  return { w, h };
}

function renderHistogram(el, bins, options = {}) {
  if (!el) return;
  clearChart(el);
  const { w, h } = ensureSize(el);
  const leftPad = 26;
  const rightPad = 6;
  const topPad = 6;
  const bottomPad = 12;
  const iw = Math.max(1, w - leftPad - rightPad);
  const ih = Math.max(1, h - topPad - bottomPad);
  const max = Math.max(1, Math.max(...bins, 0));
  const n = Math.max(1, bins.length || 1);
  const gap = Math.min(2, Math.floor(iw / (n * 10)));
  const barW = Math.max(1, Math.floor((iw - gap * (n - 1)) / n));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Y axis line
  const yAxis = document.createElementNS(svg.namespaceURI, 'line');
  yAxis.setAttribute('x1', String(leftPad));
  yAxis.setAttribute('x2', String(leftPad));
  yAxis.setAttribute('y1', String(topPad));
  yAxis.setAttribute('y2', String(topPad + ih));
  yAxis.setAttribute('stroke', '#d1d5db');
  yAxis.setAttribute('stroke-width', '1');
  svg.appendChild(yAxis);

  // Baseline
  const baseline = document.createElementNS(svg.namespaceURI, 'line');
  baseline.setAttribute('x1', String(leftPad));
  baseline.setAttribute('x2', String(leftPad + iw));
  baseline.setAttribute('y1', String(topPad + ih));
  baseline.setAttribute('y2', String(topPad + ih));
  baseline.setAttribute('stroke', '#d1d5db');
  baseline.setAttribute('stroke-width', '1');
  svg.appendChild(baseline);

  // Y ticks: 0, mid, max (unique)
  const mid = Math.round(max / 2);
  const ticks = Array.from(new Set([0, mid, max])).sort((a, b) => a - b);
  for (const t of ticks) {
    const y = topPad + (1 - (t / max)) * ih;
    const tick = document.createElementNS(svg.namespaceURI, 'line');
    tick.setAttribute('x1', String(leftPad - 3));
    tick.setAttribute('x2', String(leftPad));
    tick.setAttribute('y1', String(y));
    tick.setAttribute('y2', String(y));
    tick.setAttribute('stroke', '#d1d5db');
    tick.setAttribute('stroke-width', '1');
    svg.appendChild(tick);

    const lbl = document.createElementNS(svg.namespaceURI, 'text');
    lbl.setAttribute('x', String(leftPad - 5));
    lbl.setAttribute('y', String(y + 3));
    lbl.setAttribute('text-anchor', 'end');
    lbl.setAttribute('font-size', '10');
    lbl.setAttribute('fill', '#6b7280');
    lbl.textContent = String(t);
    svg.appendChild(lbl);
  }

  // Bars
  for (let i = 0; i < n; i++) {
    const v = bins[i] || 0;
    const bh = Math.round((v / max) * ih) || 0;
    const x = leftPad + i * (barW + gap);
    const y = topPad + ih - bh;
    const r = document.createElementNS(svg.namespaceURI, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(barW));
    r.setAttribute('height', String(Math.max(0, bh)));
    r.setAttribute('fill', options.color || '#3b82f6');
    r.setAttribute('opacity', '0.9');
    svg.appendChild(r);
  }

  el.appendChild(svg);
}

function renderSentimentLine(el, points, options = {}) {
  if (!el) return;
  clearChart(el);
  const { w, h } = ensureSize(el);
  const leftPad = 28;
  const rightPad = 8;
  const topPad = 6;
  const bottomPad = 12;
  const iw = Math.max(1, w - leftPad - rightPad);
  const ih = Math.max(1, h - topPad - bottomPad);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  // Y axis with labels -1, 0, 1
  const yAxis = document.createElementNS(svg.namespaceURI, 'line');
  yAxis.setAttribute('x1', String(leftPad));
  yAxis.setAttribute('x2', String(leftPad));
  yAxis.setAttribute('y1', String(topPad));
  yAxis.setAttribute('y2', String(topPad + ih));
  yAxis.setAttribute('stroke', '#d1d5db');
  yAxis.setAttribute('stroke-width', '1');
  svg.appendChild(yAxis);

  const tickVals = [-1, 0, 1];
  for (const tv of tickVals) {
    const y = topPad + (1 - (tv + 1) / 2) * ih;
    const tick = document.createElementNS(svg.namespaceURI, 'line');
    tick.setAttribute('x1', String(leftPad - 3));
    tick.setAttribute('x2', String(leftPad));
    tick.setAttribute('y1', String(y));
    tick.setAttribute('y2', String(y));
    tick.setAttribute('stroke', '#d1d5db');
    tick.setAttribute('stroke-width', '1');
    svg.appendChild(tick);

    const lbl = document.createElementNS(svg.namespaceURI, 'text');
    lbl.setAttribute('x', String(leftPad - 5));
    lbl.setAttribute('y', String(y + 3));
    lbl.setAttribute('text-anchor', 'end');
    lbl.setAttribute('font-size', '10');
    lbl.setAttribute('fill', '#6b7280');
    lbl.textContent = String(tv);
    svg.appendChild(lbl);
  }

  // zero guide across
  const midY = topPad + ih * 0.5;
  const zero = document.createElementNS(svg.namespaceURI, 'line');
  zero.setAttribute('x1', String(leftPad));
  zero.setAttribute('x2', String(leftPad + iw));
  zero.setAttribute('y1', String(midY));
  zero.setAttribute('y2', String(midY));
  zero.setAttribute('stroke', '#d1d5db');
  zero.setAttribute('stroke-width', '1');
  zero.setAttribute('stroke-dasharray', '3,3');
  svg.appendChild(zero);

  if (!Array.isArray(points) || points.length === 0) {
    el.appendChild(svg);
    return;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const path = document.createElementNS(svg.namespaceURI, 'path');
  const toXY = (p) => {
    const x = leftPad + clamp(p.t, 0, 1) * iw;
    const s = clamp(p.s, -1, 1);
    const y = topPad + (1 - (s + 1) / 2) * ih; // -1 -> bottom, +1 -> top
    return { x, y };
  };
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const { x, y } = toXY(points[i]);
    d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', options.color || '#10b981');
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);
  el.appendChild(svg);
}

function computeHistogramBinsFromFacts(facts, startChunk, endChunk, desiredBins = 20) {
  const S = Number(startChunk);
  const E = Number(endChunk);
  if (!Number.isFinite(S) || !Number.isFinite(E) || E <= S) return { bins: [0], count: 1 };
  const range = E - S;
  const binCount = Math.max(1, Math.min(desiredBins, Math.floor(range)));
  const bins = new Array(binCount).fill(0);
  const denom = range || 1;
  for (const f of (facts || [])) {
    const c = Number(f?.chunk_id);
    if (!Number.isFinite(c) || c < S || c >= E) continue;
    const t = (c - S) / denom;
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(t * binCount)));
    bins[idx]++;
  }
  return { bins, count: binCount };
}

function collectInteractionFactsForChar(interactions, charId, startChunk, endChunk) {
  const list = [];
  for (const inter of (interactions || [])) {
    if (inter.a_id !== charId && inter.b_id !== charId) continue;
    const facts = factsInRangeInter(inter, startChunk, endChunk);
    for (const f of facts) list.push(f);
  }
  return list;
}

function loadPanePrefs() {
  const fallback = { ...DEFAULT_PANE_PREFS };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage?.getItem(PANE_PREF_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      sidebar: Number.isFinite(Number(parsed?.sidebar)) ? Number(parsed.sidebar) : fallback.sidebar,
      dock: Number.isFinite(Number(parsed?.dock)) ? Number(parsed.dock) : fallback.dock,
    };
  } catch {
    return fallback;
  }
}

function savePanePrefs() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(PANE_PREF_KEY, JSON.stringify({
      sidebar: panePrefs.sidebar,
      dock: panePrefs.dock,
    }));
  } catch {}
}

function clampWidth(value, min, max) {
  const target = Number.isFinite(Number(value)) ? Number(value) : min;
  if (!Number.isFinite(max) || max <= min) return Math.max(min, target);
  return Math.min(max, Math.max(min, target));
}

function getLayoutMetrics() {
  if (!mainLayout) {
    return { contentWidth: 0, dockVisible: false, stageHandleWidth: 0, dockHandleWidth: 0 };
  }
  const styles = window.getComputedStyle(mainLayout);
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
  const contentWidth = Math.max(0, mainLayout.clientWidth - paddingLeft - paddingRight);
  const dockVisible = mainLayout.classList.contains('show-text-dock');
  return {
    contentWidth,
    dockVisible,
    stageHandleWidth: handleStageSidebar?.offsetWidth || 0,
    dockHandleWidth: dockVisible ? (handleDockStage?.offsetWidth || 0) : 0,
  };
}

function scheduleGraphResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    updateSimBoundsFromStage(stage, svg);
    reheatSimulation();
    render();
    // Also refresh sidebar charts to adapt to new widths
    renderSidebar();
  });
}

function applyPaneWidths(opts = {}) {
  const { updateBounds = false } = opts;
  if (sidebar) {
    panePrefs.sidebar = clampSidebarWidth(panePrefs.sidebar);
    sidebar.style.flexBasis = `${panePrefs.sidebar}px`;
  }
  if (textDock) {
    if (mainLayout?.classList.contains('show-text-dock')) {
      panePrefs.dock = clampDockWidth(panePrefs.dock);
    }
    textDock.style.flexBasis = `${panePrefs.dock}px`;
  }
  if (updateBounds) scheduleGraphResize();
}

function clampSidebarWidth(value) {
  const m = getLayoutMetrics();
  const dockWidth = m.dockVisible ? panePrefs.dock : 0;
  const handles = m.stageHandleWidth + (m.dockVisible ? m.dockHandleWidth : 0);
  const max = Math.max(0, m.contentWidth - dockWidth - handles); // whatever is left after dock + handles
  return clampWidth(value, 0, max);
}

function clampDockWidth(value) {
  const m = getLayoutMetrics();
  if (!m.dockVisible) return Math.max(0, value);
  const handles = m.stageHandleWidth + m.dockHandleWidth;
  const max = Math.max(0, m.contentWidth - panePrefs.sidebar - handles);
  return clampWidth(value, 0, max);
}

function setSidebarWidth(width) {
  panePrefs.sidebar = clampSidebarWidth(width);
  applyPaneWidths({ updateBounds: true });
}

function setDockWidth(width) {
  panePrefs.dock = clampDockWidth(width);
  applyPaneWidths({ updateBounds: true });
}

function setupResizeHandles() {
  attachResizeHandle(handleDockStage, 'dock-stage');
  attachResizeHandle(handleStageSidebar, 'stage-sidebar');
}

function attachResizeHandle(handle, type) {
  if (!handle) return;
  handle.addEventListener('pointerdown', (ev) => beginResize(ev, type, handle));
}

function beginResize(ev, type, handle) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  resizeState.type = type;
  resizeState.pointerId = ev.pointerId;
  resizeState.startX = ev.clientX;
  resizeState.startSidebar = panePrefs.sidebar;
  resizeState.startDock = panePrefs.dock;
  resizeState.handle = handle;
  resizeState.prevUserSelect = document.body.style.userSelect || '';
  resizeState.prevCursor = document.body.style.cursor || '';
  handle.classList.add('dragging');
  if (handle.setPointerCapture) handle.setPointerCapture(ev.pointerId);
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
  ensureResizeOverlay(type);
  window.addEventListener('pointermove', onResizeMove, { passive: false });
  window.addEventListener('pointerup', endResize);
  window.addEventListener('pointercancel', endResize);
}

function onResizeMove(ev) {
  if (resizeState.pointerId == null || ev.pointerId !== resizeState.pointerId) return;
  ev.preventDefault();
  const delta = ev.clientX - resizeState.startX;
  if (resizeState.type === 'dock-stage') {
    setDockWidth(resizeState.startDock + delta);
  } else if (resizeState.type === 'stage-sidebar') {
    setSidebarWidth(resizeState.startSidebar - delta);
  }
}

function endResize(ev) {
  if (resizeState.pointerId == null || ev.pointerId !== resizeState.pointerId) return;
  window.removeEventListener('pointermove', onResizeMove);
  window.removeEventListener('pointerup', endResize);
  window.removeEventListener('pointercancel', endResize);
  if (resizeState.handle) {
    resizeState.handle.classList.remove('dragging');
    if (resizeState.handle.releasePointerCapture) resizeState.handle.releasePointerCapture(ev.pointerId);
  }
  document.body.style.userSelect = resizeState.prevUserSelect;
  document.body.style.cursor = resizeState.prevCursor;
  teardownResizeOverlay();
  resizeState.type = null;
  resizeState.pointerId = null;
  resizeState.handle = null;
  resizeState.prevUserSelect = '';
  resizeState.prevCursor = '';
  savePanePrefs();
  scheduleGraphResize();
}

function ensureResizeOverlay(type) {
  if (resizeOverlay) return;
  resizeOverlay = document.createElement('div');
  resizeOverlay.className = 'resize-overlay';
  Object.assign(resizeOverlay.style, {
    position: 'fixed',
    inset: '0',
    cursor: type === 'dock-stage' || type === 'stage-sidebar' ? 'col-resize' : 'default',
    zIndex: 999,
    pointerEvents: 'auto',
    background: 'transparent',
    touchAction: 'none',
  });
  document.body.appendChild(resizeOverlay);
}

function teardownResizeOverlay() {
  if (!resizeOverlay) return;
  if (resizeOverlay.parentNode) resizeOverlay.parentNode.removeChild(resizeOverlay);
  resizeOverlay = null;
}

function getTextViewerUrl(chunkId, opts = {}) {
  if (!state.data?.sourceName || !Number.isFinite(chunkId) || chunkId < 1) return null;
  const params = new URLSearchParams();
  params.set('src', String(state.data.sourceName));
  params.set('chunk', String(chunkId));
  if (opts.noHighlight) params.set('nohighlight', '1');
  return `text_viewer.html?${params.toString()}`;
}

function showTextDock() {
  if (mainLayout) mainLayout.classList.add('show-text-dock');
  applyPaneWidths({ updateBounds: true });
}

function hideTextDock() {
  if (mainLayout) mainLayout.classList.remove('show-text-dock');
  applyPaneWidths({ updateBounds: true });
}

function openTextDock(chunkId, options = {}) {
  const { setActiveChunk = true } = options;
  const fallbackChunk = Number((state.base || 0) + (state.startChunk || 0));
  const requestedChunk = Number(chunkId);
  const chunk = Number.isFinite(requestedChunk) && requestedChunk > 0
    ? requestedChunk
    : (Number.isFinite(fallbackChunk) && fallbackChunk > 0 ? fallbackChunk : 1);
  const url = getTextViewerUrl(chunk, { noHighlight: !setActiveChunk });
  if (!url) return;
  if (!mainLayout || !textDock || !textFrame) {
    window.open(url, '_blank');
    return;
  }
  const desiredSrc = String(state.data?.sourceName || '');
  const currentSrc = textFrame.dataset.currentSrc || '';
  textFrame.dataset.currentChunk = String(chunk);
  // Only set src (reload) when source changes or iframe is empty; otherwise, message the viewer.
  if (!textFrame.dataset.currentUrl || currentSrc !== desiredSrc) {
    textFrame.src = url;
    textFrame.dataset.currentUrl = url;
    textFrame.dataset.currentSrc = desiredSrc;
    // Remember whether to suppress active-chunk on next load
    textFrame.dataset.suppressNextActiveChunk = setActiveChunk ? '' : '1';
  } else {
    // Same source: avoid reload; just update selection and active chunk.
    try { sendRangeToTextDock(); } catch {}
    if (setActiveChunk) {
      try { sendActiveChunkToTextDock(); } catch {}
    } else {
      try { sendClearActiveChunkToTextDock(); } catch {}
      try { sendScrollToChunkToTextDock(); } catch {}
    }
  }
  showTextDock();
  // Push current selection range to the text viewer (also handled on load)
  sendRangeToTextDock();
}

if (textCloseBtn) textCloseBtn.addEventListener('click', hideTextDock);
if (textFrame) textFrame.addEventListener('load', () => {
  // After load, sync range and either set or clear active chunk per intent
  sendRangeToTextDock();
  const suppress = textFrame.dataset.suppressNextActiveChunk === '1';
  if (suppress) {
    sendClearActiveChunkToTextDock();
    sendScrollToChunkToTextDock();
    textFrame.dataset.suppressNextActiveChunk = '';
  } else {
    sendActiveChunkToTextDock();
  }
});

function sendRangeToTextDock() {
  if (!textFrame || !textFrame.contentWindow) return;
  const base = state.base || 0;
  const S = Number(state.startChunk || 0);
  const E = Number(state.chunk || 0);
  // Active facts are S <= c < E, use inclusive end for display
  const startAbs = base + S;
  const endAbs = base + Math.max(S, E - 1);
  try {
    textFrame.contentWindow.postMessage({
      type: 'booknet:setRange',
      payload: { start: startAbs, end: endAbs }
    }, '*');
  } catch {}
}

function sendActiveChunkToTextDock() {
  if (!textFrame || !textFrame.contentWindow) return;
  const chunk = Number(textFrame.dataset.currentChunk || 0);
  if (!Number.isFinite(chunk) || chunk < 1) return;
  try {
    textFrame.contentWindow.postMessage({
      type: 'booknet:setActiveChunk',
      payload: { chunk }
    }, '*');
  } catch {}
}

function sendClearActiveChunkToTextDock() {
  if (!textFrame || !textFrame.contentWindow) return;
  try {
    textFrame.contentWindow.postMessage({ type: 'booknet:clearActiveChunk' }, '*');
  } catch {}
}

function sendScrollToChunkToTextDock() {
  if (!textFrame || !textFrame.contentWindow) return;
  const chunk = Number(textFrame.dataset.currentChunk || 0);
  if (!Number.isFinite(chunk) || chunk < 1) return;
  try {
    textFrame.contentWindow.postMessage({ type: 'booknet:scrollToChunk', payload: { chunk } }, '*');
  } catch {}
}

function updateGraphStructure() {
  const data = state.data; if (!data) return;
  const S = state.startChunk;
  const E = state.chunk;
  const base = state.base || 0;
  const startChunk = base + S;
  const chunk = base + E;
  const allChars = data.characters || [];
  const allInters = data.interactions || [];

  const visibleChars = allChars.filter(c => factsInRangeChar(c, startChunk, chunk).length > 0);
  const seedMap = state.layout.size ? state.layout : new Map();
  const visibleIds = new Set(visibleChars.map(c => c.id));
  for (const ch of visibleChars) {
    const seed = seedMap.get(ch.id);
    const n = ensureNode(ch.id, seed);
    const facts = factsInRangeChar(ch, startChunk, chunk);
    const baseRadius = 10;
    const scalePerSqrt = 4;
    const maxRadius = baseRadius + 26;
    const rawRadius = Math.min(maxRadius, baseRadius + Math.floor(scalePerSqrt * Math.sqrt(facts.length || 0)));
    // Double visual node size by doubling target radius
    n.rTarget = Math.max(2, (rawRadius / 5) * 2);
  }
  for (const id of Array.from(sim.nodes.keys())) {
    if (!visibleIds.has(id)) { removeNode(id); deleteNodeDom(id); }
  }

  const visibleEdges = [];
  for (const inter of allInters) {
    if (!visibleIds.has(inter.a_id) || !visibleIds.has(inter.b_id)) continue;
    const weight = factsInRangeInter(inter, startChunk, chunk).length;
    if (weight <= 0) continue;
    const rel = getCurrentRel(inter, (chunk || 0) - 1);
    visibleEdges.push({ id: inter.id, a: inter.a_id, b: inter.b_id, weight, score: rel.score });
  }
  const newEdgeIds = new Set();
  for (const e of visibleEdges) {
    ensureEdge(e.id, e.a, e.b, e.weight, e.score);
    newEdgeIds.add(e.id);
    upsertEdgeDom(e, {
      getTooltipText: (edgeId) => {
        const inter = (state.data.interactions || []).find(it => it.id === edgeId) || {};
        const upTo = (state.base || 0) + Math.max(0, (state.chunk || 0) - 1);
        return getCurrentRel(inter, upTo).text || '';
      },
      onClick: (edgeId) => {
        state.selectedEdgeId = edgeId;
        state.selectedId = null;
        state.rememberedSelection = { type: 'edge', id: edgeId };
        renderSidebar();
      },
    });
  }
  for (const id of Array.from(sim.edges.keys())) {
    if (!newEdgeIds.has(id)) { sim.edges.delete(id); deleteEdgeDom(id); }
  }
  rebuildEdgeList();

  for (const ch of visibleChars) {
    const n = sim.nodes.get(ch.id);
    upsertNodeDom(n, ch.name, {
      getTooltipText: (nodeId) => {
        const char = (state.data.characters || []).find(c => c.id === nodeId);
        const upTo = (state.base || 0) + Math.max(0, (state.chunk || 0) - 1);
        return char ? getCurrentSummary(char, upTo) : '';
      },
      onClick: (nodeId) => {
        state.selectedId = nodeId;
        state.selectedEdgeId = null;
        state.rememberedSelection = { type: 'node', id: nodeId };
        renderSidebar();
      },
    });
  }

  applyPositionsToDOM();
  // If current selection is not visible, temporarily clear it,
  // but keep rememberedSelection so we can restore later if it reappears.
  if (state.selectedId && !visibleIds.has(state.selectedId)) {
    state.selectedId = null;
  }
  const visibleEdgeIds = new Set(visibleEdges.map(e => e.id));
  if (state.selectedEdgeId && !visibleEdgeIds.has(state.selectedEdgeId)) {
    state.selectedEdgeId = null;
  }
  // Restore selection if nothing else is selected and the remembered one is visible again
  if (!state.selectedId && !state.selectedEdgeId && state.rememberedSelection) {
    if (state.rememberedSelection.type === 'node' && visibleIds.has(state.rememberedSelection.id)) {
      state.selectedId = state.rememberedSelection.id;
    } else if (state.rememberedSelection.type === 'edge' && visibleEdgeIds.has(state.rememberedSelection.id)) {
      state.selectedEdgeId = state.rememberedSelection.id;
    }
  }
  reheatSimulation();
}

function animate() {
  if (!sim.running) return;
  stepPhysics();
  applyPositionsToDOM();
  sim.raf = requestAnimationFrame(animate);
}

function render() { if (state.data) updateGraphStructure(); }

function appendEventItem(listEl, { titleText, metaText, hoverText, chunkId }) {
  const li = document.createElement('li');
  li.className = 'event-item';
  const title = document.createElement('div');
  title.textContent = titleText || '';
  li.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = metaText || '';
  li.appendChild(meta);
  li.addEventListener('mousemove', (e) => {
    tooltip.textContent = hoverText || '';
    tooltip.style.opacity = '1';
    positionTooltip(tooltip, e.clientX, e.clientY);
  });
  li.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
  if (state.data && state.data.sourceName && typeof chunkId === 'number') {
    li.style.cursor = 'pointer';
    li.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (ev.metaKey || ev.ctrlKey) {
        const url = getTextViewerUrl(chunkId);
        if (url) window.open(url, '_blank');
        return;
      }
      openTextDock(chunkId);
    });
  }
  listEl.appendChild(li);
}

function renderSidebar() {
  const data = state.data;
  if (!data) {
    charPanel.style.display = 'none';
    interPanel.style.display = 'none';
    sidebarHint.style.display = 'block';
    if (sidebarTitle) sidebarTitle.textContent = 'Character Details';
    return;
  }
  const base = state.base || 0;
  const S = state.startChunk;
  const E = state.chunk;
  const startChunk = base + S;
  const chunk = base + E;

  if (state.selectedId) {
    const id = state.selectedId;
    const ch = data.characters.find(c => c.id === id);
    if (!ch) return;
    sidebarHint.style.display = 'none';
    if (sidebarTitle) sidebarTitle.textContent = 'Character Details';
    interPanel.style.display = 'none';
    charPanel.style.display = 'block';
    charHeader.textContent = ch.name;
    // Latest active character summary (same as hover)
    const upTo = (state.base || 0) + Math.max(0, (state.chunk || 0) - 1);
    const summaryText = getCurrentSummary(ch, upTo) || '';
    if (charSummary) {
      charSummary.textContent = summaryText;
      charSummary.style.display = summaryText ? 'block' : 'none';
    }
    // Character charts (activity + interactions) in the current selection
    if (charFactHistEl || charInterHistEl) {
      const { bins: charBins } = computeHistogramBinsFromFacts(
        factsInRangeChar(ch, startChunk, chunk), startChunk, chunk, 20
      );
      if (charFactHistEl) renderHistogram(charFactHistEl, charBins, { color: '#3b82f6' });

      const interFacts = collectInteractionFactsForChar(data.interactions || [], ch.id, startChunk, chunk);
      const { bins: interBins } = computeHistogramBinsFromFacts(interFacts, startChunk, chunk, 20);
      if (charInterHistEl) renderHistogram(charInterHistEl, interBins, { color: '#6366f1' });
    }
    const endInclusive = Math.max(startChunk, (chunk || 0) - 1);
    const facts = factsInRangeChar(ch, startChunk, chunk).sort((a, b) => (a.chunk_id - b.chunk_id) || (a.fact_id - b.fact_id));
    charStatus.textContent = `Facts in chunks ${startChunk}–${endInclusive}: ${facts.length}`;
    charStatus.style.color = '#374151';
    eventList.innerHTML = '';
    for (const f of facts) {
      appendEventItem(eventList, {
        titleText: `[${f.fact_id}] ${f.text}`,
        metaText: ch.name,
        hoverText: `Argument: ${f.argument || ''} (chunk ${f.chunk_id ?? '?'})`,
        chunkId: f.chunk_id,
      });
    }
    return;
  }

  if (state.selectedEdgeId) {
    const eId = state.selectedEdgeId;
    const inter = (data.interactions || []).find(it => it.id === eId);
    if (!inter) return;
    sidebarHint.style.display = 'none';
    if (sidebarTitle) sidebarTitle.textContent = 'Relationship Detail';
    charPanel.style.display = 'none';
    interPanel.style.display = 'block';
    const rel = getCurrentRel(inter, (chunk || 0) - 1);
    // Latest active relationship summary (same as hover)
    if (interSummary) {
      const relText = rel?.text || '';
      interSummary.textContent = relText;
      interSummary.style.display = relText ? 'block' : 'none';
    }
    // Relationship charts: histogram of facts + sentiment over time
    if (interFactHistEl || interSentChartEl) {
      const factsForHist = factsInRangeInter(inter, startChunk, chunk);
      const { bins } = computeHistogramBinsFromFacts(factsForHist, startChunk, chunk, 20);
      if (interFactHistEl) renderHistogram(interFactHistEl, bins, { color: '#f59e0b' });

      // Sentiment series: start at first in-range summary, not before
      const S0 = startChunk, E0 = chunk;
      const denom = Math.max(1, (E0 - S0));
      const summaries = Array.isArray(inter?.summaries) ? inter.summaries.slice().sort((a, b) => a.chunk_id - b.chunk_id) : [];
      const inRange = [];
      for (const sm of summaries) {
        const c = Number(sm?.chunk_id);
        if (!Number.isFinite(c) || c < S0 || c >= E0) continue;
        const t = (c - S0) / denom;
        inRange.push({ t, s: Number(sm.score || 0) });
      }
      if (interSentChartEl) {
        if (inRange.length === 0) {
          // No points in range: draw only axes
          renderSentimentLine(interSentChartEl, [], { color: '#10b981' });
        } else {
          const pts = [...inRange];
          const last = pts[pts.length - 1];
          if (last.t < 1) pts.push({ t: 1, s: last.s });
          renderSentimentLine(interSentChartEl, pts, { color: '#10b981' });
        }
      }
    }
    const facts = factsInRangeInter(inter, startChunk, chunk).sort((a, b) => (a.chunk_id - b.chunk_id) || (a.fact_id - b.fact_id));
    interHeader.textContent = `${inter.a_name} • ${inter.b_name}`;
    interStatus.textContent = `Facts in chunks ${startChunk}–${Math.max(startChunk, (chunk || 0) - 1)}: ${facts.length} • Sentiment: ${rel.score.toFixed(2)}`;
    interStatus.style.color = '#374151';
    interEventList.innerHTML = '';
    for (const f of facts) {
      appendEventItem(interEventList, {
        titleText: `[${f.fact_id}] ${f.text}`,
        metaText: `${inter.a_name} • ${inter.b_name}`,
        hoverText: `Evidence: ${f.evidence || ''} (chunk ${f.chunk_id ?? '?'})`,
        chunkId: f.chunk_id,
      });
    }
    return;
  }

  charPanel.style.display = 'none';
  interPanel.style.display = 'none';
  sidebarHint.style.display = 'block';
  if (sidebarTitle) sidebarTitle.textContent = 'Character Details';
}

function clampSelection(N, S, E, moved) {
  // Domain enforcement: progress bar is [0, N], S ∈ [0, N-1], E ∈ [1, N], and E - S ≥ 1
  const total = Math.max(0, Math.floor(Number(N || 0)));
  if (total === 0) return { S: 0, E: 0, N: 0 };
  const toInt = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : fallback;
  };
  let s = toInt(S, 0);
  let e = toInt(E, total);
  s = Math.min(Math.max(0, s), total - 1);
  e = Math.min(Math.max(1, e), total);
  if (e - s < 1) {
    if (moved === 'start') s = Math.max(0, Math.min(e - 1, s));
    else e = Math.min(total, Math.max(s + 1, e));
  }
  return { S: s, E: e, N: total };
}

function updateProgressUI(S, E, N) {
  const total = Math.max(0, Number(N || 0));
  const base = state.base || 0;
  if (total <= 0) {
    if (progressLabel) progressLabel.textContent = 'Active: 0%–0% • Chunks 0–0/0';
    if (rangeTrack) updateRangeTrackFill(0, 0);
    return;
  }
  const denom = Math.max(1, total);
  const startPercent = (S / denom) * 100;
  const endPercent = (E / denom) * 100;
  const startLabel = base + S;
  const endInclusiveLabel = base + Math.max(S, E - 1); // active facts are S <= c < E
  const denomInclusive = base + Math.max(0, total - 1);
  if (progressLabel) {
    progressLabel.textContent = `Active: ${Math.round(startPercent)}%–${Math.round(endPercent)}% • Chunks ${startLabel}–${endInclusiveLabel}/${denomInclusive}`;
  }
  updateRangeTrackFill(startPercent, endPercent);
}

function updateRangeFromSliders(ev) {
  if (!state.data) return;
  const moved = ev?.target === rangeStart ? 'start' : ev?.target === rangeEnd ? 'end' : undefined;
  const nextS = Number(rangeStart?.value ?? state.startChunk);
  const nextE = Number(rangeEnd?.value ?? state.chunk);
  setSelection(nextS, nextE, moved);
}

function updateRangeTrackFill(pStart, pEnd) {
  if (!rangeTrack) return;
  const left = Math.min(pStart, pEnd);
  const right = Math.max(pStart, pEnd);
  rangeTrack.style.background = `linear-gradient(to right, #e5e7eb 0%, #e5e7eb ${left}%, #3b82f6 ${left}%, #3b82f6 ${right}%, #e5e7eb ${right}%, #e5e7eb 100%)`;
}

function setSelection(nextS, nextE, moved) {
  const { S, E, N } = clampSelection(state.N, nextS, nextE, moved);
  state.startChunk = S;
  state.chunk = E;
  if (rangeStart) rangeStart.value = String(S);
  if (rangeEnd) rangeEnd.value = String(E);
  updateProgressUI(S, E, N);
  render();
  renderSidebar();
  // Notify the text viewer of the new active range
  sendRangeToTextDock();
}

function onResize() {
  if (!state.data) return;
  updateSimBoundsFromStage(stage, svg);
  render();
}

async function init() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.data = data;

    let minId = Infinity, maxId = -Infinity;
    const scanFacts = (facts) => {
      if (!Array.isArray(facts)) return;
      for (const f of facts) {
        const c = Number(f?.chunk_id);
        if (!Number.isFinite(c)) continue;
        if (c < minId) minId = c;
        if (c > maxId) maxId = c;
      }
    };
    for (const ch of (data.characters || [])) scanFacts(ch.facts);
    for (const it of (data.interactions || [])) scanFacts(it.facts);
    const declaredN = Number(data.maxChunk || 0);
    const hasScan = Number.isFinite(minId) && Number.isFinite(maxId) && maxId >= minId;
    const computedN = hasScan ? (maxId - minId + 1) : declaredN;
    state.base = hasScan ? minId : 0;
    const maxChunkCount = Math.max(declaredN || 0, computedN || 0);
    state.N = Math.max(0, Number.isFinite(maxChunkCount) ? Math.floor(maxChunkCount) : 0);

    if (data?.sourceName) { sourceBadge.textContent = String(data.sourceName); sourceBadge.style.display = 'block'; }
    else { sourceBadge.style.display = 'none'; }

    const N = state.N;
    if (rangeStart) {
      rangeStart.min = '0';
      rangeStart.max = String(Math.max(0, N));
      rangeStart.step = '1';
    }
    if (rangeEnd) {
      rangeEnd.min = '0';
      rangeEnd.max = String(Math.max(0, N));
      rangeEnd.step = '1';
    }

    state.layout = computeLayout(data.characters || [], stage);
    updateSimBoundsFromStage(stage, svg);
    clearSVG();
    setSelection(0, N);
    if (!sim.running) { sim.running = true; sim.raf = requestAnimationFrame(animate); }
  } catch (err) {
    console.error('Failed to load data:', err);
    sidebarHint.textContent = 'Could not load data. Run: python scripts/export_network_json.py then serve this folder via a local web server.';
  }
  if (rangeStart) rangeStart.addEventListener('input', updateRangeFromSliders);
  if (rangeEnd) rangeEnd.addEventListener('input', updateRangeFromSliders);
  window.addEventListener('resize', onResize);

  window.graph = { state, sim, dom, reheat: reheatSimulation, render, applyPositionsToDOM };
}

init();
