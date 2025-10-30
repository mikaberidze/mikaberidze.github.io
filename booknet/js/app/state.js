// Shared application state and view helpers.

export const state = {
  data: null,
  N: 0,
  base: 0,
  startChunk: 0,
  chunk: 0,
  selectedId: null,
  selectedEdgeId: null,
  rememberedSelection: null, // { type: 'node'|'edge', id }
  history: [],
  _suppressHistory: false,
  layout: new Map(),
  book: '',
};

export function normalizeId(value) {
  if (value == null) return null;
  return String(value);
}

export function getCurrentView() {
  if (state.selectedEdgeId) return { type: 'edge', id: state.selectedEdgeId };
  if (state.selectedId) return { type: 'node', id: state.selectedId };
  return { type: 'home' };
}

export function viewsEqual(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  return normalizeId(a.id) === normalizeId(b.id);
}

export function resetSelection() {
  state.selectedId = null;
  state.selectedEdgeId = null;
  state.rememberedSelection = null;
}
