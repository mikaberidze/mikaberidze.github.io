// Manages sidebar / dock sizing, persistence, and resize gestures.

const PANE_PREF_KEY = 'booknetPanePrefs';
const DEFAULT_PANE_PREFS = { sidebar: 320, dock: 360 };
const SIDEBAR_MIN = 100;
const SIDEBAR_MAX = 1500;
const DOCK_MIN = 100;
const DOCK_MAX = 1500;
const STAGE_MIN = 150;

export function loadPanePrefs() {
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

function savePanePrefs(panePrefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(PANE_PREF_KEY, JSON.stringify({
      sidebar: panePrefs.sidebar,
      dock: panePrefs.dock,
    }));
  } catch {}
}

export function createPaneLayoutController({
  mainLayout,
  sidebar,
  textDock,
  handleDockStage,
  handleStageSidebar,
  onResizeRequested,
}) {
  const panePrefs = loadPanePrefs();
  let resizeRaf = null;
  const resizeState = {
    type: null,
    pointerId: null,
    anchorX: 0,
    anchorSidebar: 0,
    anchorDock: 0,
    handle: null,
    prevUserSelect: '',
    prevCursor: '',
    pointerOffset: 0,
    overshoot: 0,
  };
  let resizeOverlay = null;

  function scheduleResize() {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      onResizeRequested?.();
    });
  }

  function clampWidth(value, min, max) {
    const lo = Number.isFinite(Number(min)) ? Number(min) : 0;
    const target = Number.isFinite(Number(value)) ? Number(value) : lo;
    if (!Number.isFinite(Number(max))) return Math.max(lo, target);
    const hi = Math.max(lo, Number(max));
    if (hi <= lo) return lo;
    return Math.min(hi, Math.max(lo, target));
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

  function clampSidebarWidth(value) {
    const m = getLayoutMetrics();
    const handles = m.stageHandleWidth + (m.dockVisible ? m.dockHandleWidth : 0);
    const effectiveDock = m.dockVisible
      ? Math.max(DOCK_MIN, Math.min(DOCK_MAX, Number(panePrefs.dock) || 0))
      : 0;
    const maxByLayout = Math.max(0, m.contentWidth - effectiveDock - handles - STAGE_MIN);
    const hi = Math.min(SIDEBAR_MAX, maxByLayout);
    return clampWidth(value, SIDEBAR_MIN, hi);
  }

  function clampDockWidth(value) {
    const m = getLayoutMetrics();
    if (!m.dockVisible) return Math.max(0, value);
    const handles = m.stageHandleWidth + m.dockHandleWidth;
    const effectiveSidebar = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(panePrefs.sidebar) || 0));
    const maxByLayout = Math.max(0, m.contentWidth - effectiveSidebar - handles - STAGE_MIN);
    const hi = Math.min(DOCK_MAX, maxByLayout);
    return clampWidth(value, DOCK_MIN, hi);
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
    if (updateBounds) scheduleResize();
  }

  function setSidebarWidth(width) {
    const clamped = clampSidebarWidth(width);
    panePrefs.sidebar = clamped;
    applyPaneWidths({ updateBounds: true });
    return clamped;
  }

  function setDockWidth(width) {
    const clamped = clampDockWidth(width);
    panePrefs.dock = clamped;
    applyPaneWidths({ updateBounds: true });
    return clamped;
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

  function onResizeMove(ev) {
    if (resizeState.pointerId == null || ev.pointerId !== resizeState.pointerId) return;
    ev.preventDefault();
    const effectiveX = ev.clientX - resizeState.pointerOffset;
    const delta = effectiveX - resizeState.anchorX;
    if (resizeState.type === 'dock-stage') {
      const wanted = resizeState.anchorDock + delta;
      const clamped = clampDockWidth(wanted);
      resizeState.overshoot = wanted - clamped;
      setDockWidth(clamped);
    } else if (resizeState.type === 'stage-sidebar') {
      const wanted = resizeState.anchorSidebar - delta;
      const clamped = clampSidebarWidth(wanted);
      resizeState.overshoot = wanted - clamped;
      setSidebarWidth(clamped);
    }
  }

  function endResize(ev) {
    if (resizeState.pointerId == null || ev.pointerId !== resizeState.pointerId) return;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', endResize);
    window.removeEventListener('pointercancel', endResize);
    if (resizeState.handle) {
      resizeState.handle.classList.remove('dragging');
      if (resizeState.handle.releasePointerCapture) {
        resizeState.handle.releasePointerCapture(ev.pointerId);
      }
    }
    document.body.style.userSelect = resizeState.prevUserSelect;
    document.body.style.cursor = resizeState.prevCursor;
    teardownResizeOverlay();
    resizeState.type = null;
    resizeState.pointerId = null;
    resizeState.handle = null;
    resizeState.prevUserSelect = '';
    resizeState.prevCursor = '';
    resizeState.pointerOffset = 0;
    resizeState.anchorX = 0;
    resizeState.anchorSidebar = 0;
    resizeState.anchorDock = 0;
    resizeState.overshoot = 0;
    savePanePrefs(panePrefs);
  }

  function beginResize(ev, type, handle) {
    const isTouchLike = ev.pointerType === 'touch' || ev.pointerType === 'pen';
    if (!isTouchLike && ev.button !== 0) return;
    ev.preventDefault();
    if (type === 'dock-stage' && !(mainLayout?.classList?.contains('show-text-dock'))) return;
    resizeState.type = type;
    resizeState.pointerId = ev.pointerId;
    const handleRect = handle?.getBoundingClientRect();
    const handleX = handleRect ? (handleRect.left + handleRect.width / 2) : ev.clientX;
    resizeState.pointerOffset = ev.clientX - handleX;
    resizeState.anchorX = handleX;
    resizeState.anchorSidebar = panePrefs.sidebar;
    resizeState.anchorDock = panePrefs.dock;
    resizeState.overshoot = 0;
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

  function attachResizeHandle(handle, type) {
    if (!handle) return;
    handle.style.touchAction = handle.style.touchAction || 'none';
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.target && typeof ev.target.closest === 'function' && ev.target.closest('button')) return;
      beginResize(ev, type, handle);
    });
  }

  function setupResizeHandles() {
    attachResizeHandle(handleDockStage, 'dock-stage');
    attachResizeHandle(handleStageSidebar, 'stage-sidebar');
  }

  applyPaneWidths();

  return {
    panePrefs,
    applyPaneWidths,
    setSidebarWidth,
    setDockWidth,
    clampSidebarWidth,
    clampDockWidth,
    setupResizeHandles,
    scheduleResize,
  };
}
