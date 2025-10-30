// Sidebar navigation (history + selection switching).

import { state, getCurrentView, viewsEqual, normalizeId, resetSelection } from './state.js';

export function createNavigation({ sidebarBackBtn, sidebarHomeBtn }) {
  let renderSidebar = () => {};

  function setRenderSidebar(fn) {
    renderSidebar = typeof fn === 'function' ? fn : () => {};
  }

  function updateSidebarNavButtons() {
    if (sidebarBackBtn) sidebarBackBtn.disabled = state.history.length === 0;
  }

  function pushCurrentView() {
    if (state._suppressHistory) return;
    const current = getCurrentView();
    const last = state.history[state.history.length - 1];
    if (!last || !viewsEqual(last, current)) state.history.push(current);
    updateSidebarNavButtons();
  }

  function navigateTo(view, { push = true } = {}) {
    try {
      if (push) {
        const current = getCurrentView();
        if (!viewsEqual(current, view)) pushCurrentView();
      }
      state._suppressHistory = true;
      if (!view || view.type === 'home') {
        resetSelection();
      } else if (view.type === 'node' && view.id != null) {
        const nodeId = normalizeId(view.id);
        state.selectedId = nodeId;
        state.selectedEdgeId = null;
        state.rememberedSelection = { type: 'node', id: nodeId };
      } else if (view.type === 'edge' && view.id != null) {
        const edgeId = normalizeId(view.id);
        state.selectedEdgeId = edgeId;
        state.selectedId = null;
        state.rememberedSelection = { type: 'edge', id: edgeId };
      }
      renderSidebar();
    } finally {
      state._suppressHistory = false;
      updateSidebarNavButtons();
    }
  }

  function goBack() {
    if (!state.history.length) return;
    const prev = state.history.pop();
    updateSidebarNavButtons();
    navigateTo(prev, { push: false });
  }

  if (sidebarHomeBtn) {
    sidebarHomeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      navigateTo({ type: 'home' }, { push: true });
    });
  }

  if (sidebarBackBtn) {
    sidebarBackBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      goBack();
    });
  }

  updateSidebarNavButtons();

  return {
    navigateTo,
    goBack,
    pushCurrentView,
    updateSidebarNavButtons,
    setRenderSidebar,
  };
}
