// Controls the optional source text dock and iframe messaging.

import { state } from './state.js';

export function createTextDockController({
  mainLayout,
  textDock,
  textFrame,
  textMeta,
  textCloseBtn,
  textZoomInBtn,
  textZoomOutBtn,
  toggleTextDockBtn,
  applyPaneWidths,
}) {
  function isDockOpen() {
    return Boolean(mainLayout?.classList.contains('show-text-dock'));
  }

  function updateDockToggleButton() {
    if (!toggleTextDockBtn) return;
    const open = isDockOpen();
    toggleTextDockBtn.textContent = open ? '<' : '>';
    toggleTextDockBtn.setAttribute('aria-label', open ? 'Collapse source text panel' : 'Expand source text panel');
    toggleTextDockBtn.setAttribute('title', open ? 'Hide source text' : 'Show source text');
  }

  function showTextDock() {
    if (mainLayout) mainLayout.classList.add('show-text-dock');
    applyPaneWidths({ updateBounds: true });
    updateDockToggleButton();
  }

  function hideTextDock() {
    if (mainLayout) mainLayout.classList.remove('show-text-dock');
    applyPaneWidths({ updateBounds: true });
    updateDockToggleButton();
  }

  // --- Zoom controls for text iframe ---
  const ZOOM_KEY = 'booknet:textDockZoom';
  const MIN_ZOOM = 0.5;   // 50%
  const MAX_ZOOM = 2.0;   // 200%
  let zoom = 1.0;
  try {
    const saved = Number(window.localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(saved) && saved > 0) zoom = saved;
  } catch {}

  function clampZoom(z) {
    if (!Number.isFinite(z)) return 1.0;
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  }

  function updateZoomButtons() {
    try {
      if (textZoomOutBtn) textZoomOutBtn.disabled = (zoom <= MIN_ZOOM + 1e-9);
      if (textZoomInBtn) textZoomInBtn.disabled = (zoom >= MAX_ZOOM - 1e-9);
    } catch {}
  }

  function persistZoom() {
    try { window.localStorage.setItem(ZOOM_KEY, String(zoom)); } catch {}
  }

  function setZoom(z) {
    zoom = clampZoom(z);
    persistZoom();
    updateZoomButtons();
    sendZoomToTextDock();
  }

  function nudgeZoom(delta) {
    // Finer steps when already small for better control
    const step = zoom >= 1 ? 0.1 : (zoom >= 0.2 ? 0.05 : 0.02);
    setZoom(zoom + (Math.sign(delta || 0) || 1) * step);
  }

  function sendZoomToTextDock() {
    if (!textFrame || !textFrame.contentWindow) return;
    const pct = Math.round(zoom * 100);
    try {
      textFrame.contentWindow.postMessage({
        type: 'booknet:setZoomPct',
        payload: { pct },
      }, '*');
    } catch {}
  }


  // --- Book metadata label in toolbar ---
  function updateBookMeta(text) {
    if (!textMeta) return;
    const label = String(text || '').trim();
    textMeta.textContent = label;
    textMeta.title = label;
  }

  if (textZoomInBtn) {
    textZoomInBtn.addEventListener('click', (e) => { e.preventDefault(); nudgeZoom(+1); });
  }
  if (textZoomOutBtn) {
    textZoomOutBtn.addEventListener('click', (e) => { e.preventDefault(); nudgeZoom(-1); });
  }
  // Initialize zoom button states on startup
  updateZoomButtons();

  function getTextViewerUrl(chunkId, opts = {}) {
    if (!state.data?.sourceName || !Number.isFinite(chunkId) || chunkId < 1) return null;
    const params = new URLSearchParams();
    params.set('src', String(state.data.sourceName));
    if (state.book) params.set('book', state.book);
    params.set('chunk', String(chunkId));
    if (opts.noHighlight) params.set('nohighlight', '1');
    if (opts.noScroll) params.set('nosnap', '1');
    return `text_viewer.html?${params.toString()}`;
  }

  function sendRangeToTextDock() {
    if (!textFrame || !textFrame.contentWindow) return;
    const base = state.base || 0;
    const S = Number(state.startChunk || 0);
    const E = Number(state.chunk || 0);
    const startAbs = base + S;
    const endAbs = base + Math.max(S, E - 1);
    try {
      textFrame.contentWindow.postMessage({
        type: 'booknet:setRange',
        payload: { start: startAbs, end: endAbs },
      }, '*');
    } catch {}
  }

  function sendActiveChunkToTextDock() {
    if (!textFrame || !textFrame.contentWindow) return;
    const raw = String(textFrame.dataset.highlightChunks || '');
    const chunks = raw
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (!chunks.length) return;
    const anchorRaw = Number(textFrame.dataset.currentChunk || chunks[0]);
    const anchor = Number.isFinite(anchorRaw) && anchorRaw > 0 ? anchorRaw : chunks[0];
    const payload = { chunks, anchor };
    const scrollPref = textFrame.dataset.nextScroll;
    if (scrollPref === '0') payload.scroll = false;
    else payload.scroll = true;
    const behavior = textFrame.dataset.nextScrollBehavior;
    if (behavior) payload.behavior = behavior;
    try {
      textFrame.contentWindow.postMessage({
        type: 'booknet:setActiveChunks',
        payload,
      }, '*');
    } catch {}
  }

  function sendClearActiveChunkToTextDock() {
    if (textFrame) {
      textFrame.dataset.highlightChunks = '';
    }
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
      textFrame.contentWindow.postMessage({
        type: 'booknet:scrollToChunk',
        payload: { chunk },
      }, '*');
    } catch {}
  }

  function openTextDock(chunkId, options = {}) {
    const fallback = Number((state.base || 0) + (state.startChunk || 0));
    const defaultChunk = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
    const request = (() => {
      const result = {
        anchorChunk: defaultChunk,
        highlightChunks: [],
        setActiveChunk: options.setActiveChunk !== false,
        scroll: options.scroll !== false,
      };
      if (typeof chunkId === 'number' && Number.isFinite(chunkId) && chunkId > 0) {
        result.anchorChunk = Number(chunkId);
      } else if (chunkId && typeof chunkId === 'object') {
        const candidate = Number(chunkId.anchorChunk ?? chunkId.anchor ?? chunkId.chunk ?? chunkId.chunkId);
        if (Number.isFinite(candidate) && candidate > 0) result.anchorChunk = candidate;
        const arr = Array.isArray(chunkId.highlightChunks)
          ? chunkId.highlightChunks
          : (Array.isArray(chunkId.chunks) ? chunkId.chunks : []);
        if (arr.length) {
          result.highlightChunks = arr
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0);
        } else if (Number.isFinite(Number(chunkId.chunk))) {
          const single = Number(chunkId.chunk);
          if (single > 0) result.highlightChunks = [single];
        }
        if (chunkId.setActiveChunk != null) result.setActiveChunk = !!chunkId.setActiveChunk;
        if (chunkId.scroll != null) result.scroll = !!chunkId.scroll;
      }
      if (options.highlightChunks && Array.isArray(options.highlightChunks)) {
        result.highlightChunks = options.highlightChunks
          .map((n) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0);
      }
      result.highlightChunks = Array.from(new Set(result.highlightChunks)).sort((a, b) => a - b);
      if (result.setActiveChunk && !result.highlightChunks.length) {
        if (Number.isFinite(result.anchorChunk) && result.anchorChunk > 0) {
          result.highlightChunks = [result.anchorChunk];
        } else {
          result.setActiveChunk = false;
        }
      }
      if (!Number.isFinite(result.anchorChunk) || result.anchorChunk <= 0) {
        result.anchorChunk = defaultChunk;
      }
      if (!Number.isFinite(result.anchorChunk) || result.anchorChunk <= 0) {
        result.anchorChunk = 1;
      }
      return result;
    })();
    const { anchorChunk, highlightChunks, setActiveChunk, scroll } = request;
    const fallbackChunk = Number((state.base || 0) + (state.startChunk || 0));
    const fallbackScrollChunk = Number.isFinite(fallbackChunk) && fallbackChunk > 0 ? fallbackChunk : 1;
    const chunk = Number.isFinite(anchorChunk) && anchorChunk > 0 ? anchorChunk : fallbackScrollChunk;
    const url = getTextViewerUrl(chunk, { noHighlight: !setActiveChunk, noScroll: !scroll });
    if (!url) return;

    if (!mainLayout || !textDock || !textFrame) {
      window.open(url, '_blank');
      return;
    }

    const desiredSrc = String(state.data?.sourceName || '');
    const currentSrc = textFrame.dataset.currentSrc || '';
    textFrame.dataset.currentChunk = String(chunk);
    textFrame.dataset.highlightChunks = setActiveChunk && highlightChunks.length
      ? highlightChunks.join(',')
      : '';
    textFrame.dataset.nextScroll = scroll ? '1' : '0';
    textFrame.dataset.nextScrollBehavior = '';

    if (!textFrame.dataset.currentUrl || currentSrc !== desiredSrc) {
      textFrame.src = url;
      textFrame.dataset.currentUrl = url;
      textFrame.dataset.currentSrc = desiredSrc;
      textFrame.dataset.suppressNextActiveChunk = setActiveChunk ? '' : '1';
      textFrame.dataset.suppressNextScroll = scroll ? '' : '1';
    } else {
      try { sendRangeToTextDock(); } catch {}
      if (setActiveChunk && highlightChunks.length) {
        try { sendActiveChunkToTextDock(); } catch {}
      } else {
        try { sendClearActiveChunkToTextDock(); } catch {}
        if (scroll) { try { sendScrollToChunkToTextDock(); } catch {} }
      }
    }
    showTextDock();
    sendRangeToTextDock();
  }

  if (textCloseBtn) textCloseBtn.addEventListener('click', hideTextDock);

  if (toggleTextDockBtn) {
    const stopAll = (ev) => { ev.stopPropagation(); };
    toggleTextDockBtn.addEventListener('pointerdown', stopAll);
    toggleTextDockBtn.addEventListener('mousedown', stopAll);

    const handleToggle = () => {
      if (isDockOpen()) {
        hideTextDock();
      } else if (state?.data?.sourceName) {
        openTextDock((state.base || 0) + (state.startChunk || 0), { setActiveChunk: false, scroll: false });
      } else {
        showTextDock();
      }
    };

    toggleTextDockBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      handleToggle();
    });
    toggleTextDockBtn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        handleToggle();
      }
    });
  }

  if (textFrame) {
    textFrame.addEventListener('load', () => {
      sendRangeToTextDock();
      // Apply persisted zoom to the freshly loaded iframe document
      try { sendZoomToTextDock(); } catch {}
      updateZoomButtons();
      const suppressActive = textFrame.dataset.suppressNextActiveChunk === '1';
      const suppressScroll = textFrame.dataset.suppressNextScroll === '1';
      if (suppressActive) {
        sendClearActiveChunkToTextDock();
        if (!suppressScroll) sendScrollToChunkToTextDock();
        textFrame.dataset.suppressNextActiveChunk = '';
        textFrame.dataset.suppressNextScroll = '';
      } else {
        sendActiveChunkToTextDock();
      }
    });
  }

  updateDockToggleButton();

  return {
    showTextDock,
    hideTextDock,
    openTextDock,
    updateDockToggleButton,
    updateBookMeta,
    sendRangeToTextDock,
    sendActiveChunkToTextDock,
    sendClearActiveChunkToTextDock,
    sendScrollToChunkToTextDock,
    getTextViewerUrl,
    setZoom,
    nudgeZoom,
  };
}
