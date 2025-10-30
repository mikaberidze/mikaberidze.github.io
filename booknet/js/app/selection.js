// Selection (range slider) management.

import { state } from './state.js';

export function createSelectionController({
  rangeStart,
  rangeEnd,
  rangeTrack,
  progressLabel,
  onSelectionChange,
  sendRangeToTextDock,
}) {
  function updateRangeTrackFill(pStart, pEnd) {
    if (!rangeTrack) return;
    const left = Math.min(pStart, pEnd);
    const right = Math.max(pStart, pEnd);
    rangeTrack.style.background = `linear-gradient(to right, #e5e7eb 0%, #e5e7eb ${left}%, #3b82f6 ${left}%, #3b82f6 ${right}%, #e5e7eb ${right}%, #e5e7eb 100%)`;
  }

  function updateProgressUI(S, E, N) {
    const total = Math.max(0, Number(N || 0));
    const base = state.base || 0;
    if (total <= 0) {
      if (progressLabel) progressLabel.textContent = 'Active: 0%–0% • Chunks 0–0/0';
      updateRangeTrackFill(0, 0);
      return;
    }
    const denom = Math.max(1, total);
    const startPercent = (S / denom) * 100;
    const endPercent = (E / denom) * 100;
    const startLabel = base + S;
    const endInclusiveLabel = base + Math.max(S, E - 1);
    const denomInclusive = base + Math.max(0, total - 1);
    if (progressLabel) {
      progressLabel.textContent = `Active: ${Math.round(startPercent)}%–${Math.round(endPercent)}% • Chunks ${startLabel}–${endInclusiveLabel}/${denomInclusive}`;
    }
    updateRangeTrackFill(startPercent, endPercent);
  }

  function clampSelection(N, S, E, moved) {
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

  function setSelection(nextS, nextE, moved) {
    const { S, E, N } = clampSelection(state.N, nextS, nextE, moved);
    state.startChunk = S;
    state.chunk = E;
    if (rangeStart) rangeStart.value = String(S);
    if (rangeEnd) rangeEnd.value = String(E);
    updateProgressUI(S, E, N);
    onSelectionChange?.();
    sendRangeToTextDock?.();
  }

  function handleSliderInput(ev) {
    if (!state.data) return;
    const moved = ev?.target === rangeStart ? 'start' : ev?.target === rangeEnd ? 'end' : undefined;
    const nextS = Number(rangeStart?.value ?? state.startChunk);
    const nextE = Number(rangeEnd?.value ?? state.chunk);
    setSelection(nextS, nextE, moved);
  }

  return {
    setSelection,
    handleSliderInput,
    updateProgressUI,
  };
}
