// Character Network Viewer bootstrap.

import { collectDomElements } from './js/app/domElements.js';
import { state, resetSelection } from './js/app/state.js';
import { createNavigation } from './js/app/navigation.js';
import { createBookPicker } from './js/app/bookPicker.js';
import { createPaneLayoutController } from './js/app/paneLayout.js';
import { createTextDockController } from './js/app/textDock.js';
import { createSidebarRenderer } from './js/app/sidebar.js';
import { createGraphController } from './js/app/graphController.js';
import { createSelectionController } from './js/app/selection.js';
import { initDomGraph, clearSVG, dom } from './js/domGraph.js';
import { computeLayout } from './js/utils.js';
import { sim } from './js/sim.js';

function setupViewportHeight() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  let rafId = null;
  const apply = () => {
    rafId = null;
    const vh = window.innerHeight;
    if (!Number.isFinite(vh) || vh <= 0) return;
    root.style.setProperty('--app-viewport-height', `${vh}px`);
  };
  const schedule = () => {
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(apply);
  };
  apply();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
  }
}

function getBookFromURL() {
  try {
    const u = new URL(window.location.href);
    const b = u.searchParams.get('book') || u.searchParams.get('folder') || '';
    return b ? decodeURIComponent(b) : '';
  } catch {
    return '';
  }
}

async function fetchFirst(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {}
  }
  throw new Error('No data source resolved');
}

async function fetchOptionalJson(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeLayoutMap(raw) {
  const map = new Map();
  if (!raw || typeof raw !== 'object') return map;
  const addNode = (id, x, y) => {
    if (id == null) return;
    const nx = Number(x);
    const ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    map.set(String(id), { x: nx, y: ny });
  };
  if (Array.isArray(raw.nodes)) {
    for (const node of raw.nodes) addNode(node?.id, node?.x, node?.y);
  } else {
    for (const [id, pos] of Object.entries(raw)) addNode(id, pos?.x, pos?.y);
  }
  return map;
}

function isDesignerMode() {
  if (typeof window === 'undefined') return false;
  const hash = String(window.location.hash || '').toLowerCase();
  return hash.includes('designer');
}

const elements = collectDomElements();
setupViewportHeight();
initDomGraph({ svg: elements.svg, stage: elements.stage, tooltip: elements.tooltip });

const navigation = createNavigation({
  sidebarBackBtn: elements.sidebarBackBtn,
  sidebarHomeBtn: elements.sidebarHomeBtn,
});

function handleSaveLayout() {
  try {
    const chars = Array.isArray(state.data?.characters) ? state.data.characters : [];
    const layoutMap = state.layout instanceof Map
      ? new Map(state.layout)
      : normalizeLayoutMap(state.layout || {});
    // Compute current stage center to save coordinates relative to it
    const bbox = elements.stage?.getBoundingClientRect?.() ? elements.stage.getBoundingClientRect() : { width: 0, height: 0 };
    const cx = (bbox.width || 0) / 2;
    const cy = (bbox.height || 0) / 2;
    const seen = new Set();
    const nodes = [];
    const absMap = new Map();
    const add = (id, x, y) => {
      if (id == null) return;
      const nx = Number(x);
      const ny = Number(y);
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      const key = String(id);
      if (seen.has(key)) return;
      seen.add(key);
      // Store relative to canvas center
      nodes.push({ id: key, x: nx - cx, y: ny - cy });
      // Keep absolute positions in memory
      absMap.set(key, { x: nx, y: ny });
    };
    for (const ch of chars) {
      const key = ch?.id;
      const simNode = sim.nodes.get(key);
      if (simNode) add(key, simNode.x, simNode.y);
      else {
        const seed = layoutMap.get(String(key));
        if (seed) add(key, seed.x, seed.y);
      }
    }
    for (const node of sim.nodes.values()) {
      add(node.id, node.x, node.y);
    }
    if (!nodes.length) return;
    const safeBase = (state.book || 'layout').replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'layout';
    const payload = { coordSpace: 'center', nodes };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeBase}_layout.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    // Keep absolute coordinates in state for seeding and simulation
    state.layout = absMap;
  } catch (err) {
    console.error('Failed to export layout:', err);
  }
}

const bookPicker = createBookPicker(elements.stage, { onSaveLayout: handleSaveLayout });
bookPicker.setDesignerMode(isDesignerMode());
window.addEventListener('hashchange', () => { bookPicker.setDesignerMode(isDesignerMode()); });

let handlePaneResize = () => {};
const paneLayout = createPaneLayoutController({
  mainLayout: elements.mainLayout,
  sidebar: elements.sidebar,
  textDock: elements.textDock,
  handleDockStage: elements.handleDockStage,
  handleStageSidebar: elements.handleStageSidebar,
  onResizeRequested: () => handlePaneResize(),
});
paneLayout.setupResizeHandles();

const textDock = createTextDockController({
  mainLayout: elements.mainLayout,
  textDock: elements.textDock,
  textFrame: elements.textFrame,
  textMeta: elements.textMeta,
  textCloseBtn: elements.textCloseBtn,
  textZoomInBtn: elements.textZoomInBtn,
  textZoomOutBtn: elements.textZoomOutBtn,
  toggleTextDockBtn: elements.toggleTextDockBtn,
  applyPaneWidths: paneLayout.applyPaneWidths,
});

const sidebar = createSidebarRenderer({
  elements,
  navigateTo: navigation.navigateTo,
  openTextDock: textDock.openTextDock,
  getTextViewerUrl: textDock.getTextViewerUrl,
});
navigation.setRenderSidebar(sidebar.renderSidebar);

const graph = createGraphController({
  svg: elements.svg,
  stage: elements.stage,
  navigateTo: navigation.navigateTo,
});

handlePaneResize = () => {
  graph.updateBounds();
  graph.reheat();
  graph.render();
  // Keep the center handle aligned during pane/handle drags
  try { selection.updateProgressUI(state.startChunk, state.chunk, state.N); } catch {}
  sidebar.renderSidebar();
};

const selection = createSelectionController({
  rangeStart: elements.rangeStart,
  rangeEnd: elements.rangeEnd,
  rangeTrack: elements.rangeTrack,
  progressLabel: elements.progressLabel,
  onSelectionChange: () => {
    graph.render();
    sidebar.renderSidebar();
  },
  sendRangeToTextDock: textDock.sendRangeToTextDock,
});

if (elements.rangeStart) elements.rangeStart.addEventListener('input', selection.handleSliderInput);
if (elements.rangeEnd) elements.rangeEnd.addEventListener('input', selection.handleSliderInput);

if (elements.svg) {
  elements.svg.addEventListener('click', (ev) => {
    if (ev.target === elements.svg) {
      resetSelection();
      if (elements.tooltip) elements.tooltip.style.opacity = '0';
      sidebar.renderSidebar();
    }
  });
}

window.addEventListener('resize', () => {
  graph.updateBounds();
  graph.render();
  // Recenter the square handle on viewport resize
  try { selection.updateProgressUI(state.startChunk, state.chunk, state.N); } catch {}
});

window.graph = {
  state,
  sim,
  dom,
  reheat: graph.reheat,
  render: graph.render,
  applyPositionsToDOM: graph.applyPositionsToDOM,
};

async function init() {
  try {
    const book = getBookFromURL();
    state.book = book || '';
    if (!state.book) {
      // Ensure the middle-panel book button is visible immediately
      // and prompts the user to select a book.
      try { bookPicker.updateSourceBadge(''); } catch {}
      setTimeout(() => {
        try { bookPicker.showBookPicker(); } catch {}
      }, 0);
    }

    const encBook = book ? encodeURIComponent(book) : '';
    const candidates = book
      ? [
          `./data/${encBook}/character_network.json`,
          `./data/${encBook}/${encodeURIComponent(book)}.json`,
        ]
      : [
          `./data/character_network.json`,
        ];

    const data = await fetchFirst(candidates);
    state.data = data;

    const fallbackLayout = computeLayout(data.characters || [], elements.stage);
    const layoutUrl = state.book
      ? `./data/${encBook}/layout.json`
      : './data/layout.json';
    const layoutRaw = await fetchOptionalJson(layoutUrl);
    const layoutOverrides = normalizeLayoutMap(layoutRaw);
    // Decide if loaded coordinates are explicitly relative (new format) or absolute (legacy)
    try {
      const bbox = elements.stage?.getBoundingClientRect?.() ? elements.stage.getBoundingClientRect() : { width: 0, height: 0 };
      const w = Number(bbox.width || 0);
      const h = Number(bbox.height || 0);
      const cx = w / 2;
      const cy = h / 2;
      const coordSpace = String(layoutRaw?.coordSpace || '').toLowerCase();
      let assumeRelative;
      if (coordSpace === 'center') {
        assumeRelative = true;
      } else if (coordSpace === 'corner') {
        assumeRelative = false;
      } else {
        // Heuristic fallback for legacy files without coordSpace marker
        let hasNegative = false;
        let allWithinStage = true;
        for (const [, pos] of layoutOverrides) {
          const px = Number(pos?.x), py = Number(pos?.y);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          if (px < 0 || py < 0) hasNegative = true;
          if (!(px >= 0 && px <= w && py >= 0 && py <= h)) allWithinStage = false;
        }
        // If all coords are within current stage and non-negative, assume old absolute format
        assumeRelative = !(allWithinStage && !hasNegative);
      }
      for (const [id, pos] of layoutOverrides) {
        const px = Number(pos?.x), py = Number(pos?.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
        if (assumeRelative) fallbackLayout.set(id, { x: cx + px, y: cy + py });
        else fallbackLayout.set(id, { x: px, y: py });
      }
    } catch {
      // Fallback: if bounding box cannot be read, use raw positions as-is
      for (const [id, pos] of layoutOverrides) {
        fallbackLayout.set(id, pos);
      }
    }

    let minId = Infinity;
    let maxId = -Infinity;
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

    // If no specific book is selected via URL, keep the badge as a
    // neutral prompt rather than showing the default dataset title.
    if (state.book) {
      const label = String(data?.sourceName || state.book);
      bookPicker.updateSourceBadge(label);
      try { textDock.updateBookMeta(label); } catch {}
    } else {
      bookPicker.updateSourceBadge('');
    }

    if (elements.rangeStart) {
      elements.rangeStart.min = '0';
      elements.rangeStart.max = String(Math.max(0, state.N));
      elements.rangeStart.step = '1';
    }
    if (elements.rangeEnd) {
      elements.rangeEnd.min = '0';
      elements.rangeEnd.max = String(Math.max(0, state.N));
      elements.rangeEnd.step = '1';
    }

    state.layout = fallbackLayout;
    graph.updateBounds();
    clearSVG();
    // Default to a 0–20 chunk window (end is exclusive)
    const defaultEnd = Math.min(20, Math.max(1, state.N));
    selection.setSelection(0, defaultEnd);
    sidebar.renderSidebar();
    graph.ensureAnimation();
  } catch (err) {
    console.error('Failed to load data:', err);
    if (elements.sidebarHint) {
      elements.sidebarHint.textContent = 'Could not load data. Run: python scripts/export_network_json.py then serve this folder via a local web server.';
      elements.sidebarHint.style.display = 'block';
    }
  }
}

sidebar.renderSidebar();
init();
