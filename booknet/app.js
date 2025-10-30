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

const elements = collectDomElements();
setupViewportHeight();
initDomGraph({ svg: elements.svg, stage: elements.stage, tooltip: elements.tooltip });

const navigation = createNavigation({
  sidebarBackBtn: elements.sidebarBackBtn,
  sidebarHomeBtn: elements.sidebarHomeBtn,
});

const bookPicker = createBookPicker(elements.stage);

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
  textCloseBtn: elements.textCloseBtn,
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
      bookPicker.updateSourceBadge(String(data?.sourceName || state.book));
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

    state.layout = computeLayout(data.characters || [], elements.stage);
    graph.updateBounds();
    clearSVG();
    selection.setSelection(0, state.N);
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
