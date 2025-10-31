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
    const chunk = Number(textFrame.dataset.currentChunk || 0);
    if (!Number.isFinite(chunk) || chunk < 1) return;
    try {
      textFrame.contentWindow.postMessage({
        type: 'booknet:setActiveChunk',
        payload: { chunk },
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
      textFrame.contentWindow.postMessage({
        type: 'booknet:scrollToChunk',
        payload: { chunk },
      }, '*');
    } catch {}
  }

  function openTextDock(chunkId, options = {}) {
    const { setActiveChunk = true, scroll = true } = options;
    const fallbackChunk = Number((state.base || 0) + (state.startChunk || 0));
    const requestedChunk = Number(chunkId);
    const chunk = Number.isFinite(requestedChunk) && requestedChunk > 0
      ? requestedChunk
      : (Number.isFinite(fallbackChunk) && fallbackChunk > 0 ? fallbackChunk : 1);
    const url = getTextViewerUrl(chunk, { noHighlight: !setActiveChunk, noScroll: !scroll });
    if (!url) return;

    if (!mainLayout || !textDock || !textFrame) {
      window.open(url, '_blank');
      return;
    }

    const desiredSrc = String(state.data?.sourceName || '');
    const currentSrc = textFrame.dataset.currentSrc || '';
    textFrame.dataset.currentChunk = String(chunk);

    if (!textFrame.dataset.currentUrl || currentSrc !== desiredSrc) {
      textFrame.src = url;
      textFrame.dataset.currentUrl = url;
      textFrame.dataset.currentSrc = desiredSrc;
      textFrame.dataset.suppressNextActiveChunk = setActiveChunk ? '' : '1';
      textFrame.dataset.suppressNextScroll = scroll ? '' : '1';
    } else {
      try { sendRangeToTextDock(); } catch {}
      if (setActiveChunk) {
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
