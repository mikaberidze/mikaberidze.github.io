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
  // Create a center handle that drags the active selection as a fixed-length window
  const rangeWrap = rangeTrack?.parentElement || null;
  const centerHandle = document.createElement('div');
  centerHandle.className = 'center-handle';
  if (rangeWrap) {
    rangeWrap.appendChild(centerHandle);
    centerHandle.style.touchAction = 'none';
  }

  const DEFAULT_THUMB_SIZE = 16;
  function getThumbSize() {
    if (!rangeWrap || typeof window === 'undefined') return DEFAULT_THUMB_SIZE;
    const styles = window.getComputedStyle(rangeWrap);
    if (!styles) return DEFAULT_THUMB_SIZE;
    const raw = styles.getPropertyValue('--thumb-size') || styles.getPropertyValue('--slider-thumb-size');
    const size = parseFloat(raw);
    return Number.isFinite(size) ? size : DEFAULT_THUMB_SIZE;
  }

  function positionCenterHandle(pStart, pEnd) {
    if (!rangeWrap || !rangeTrack) return;
    const left = Math.min(pStart, pEnd);
    const right = Math.max(pStart, pEnd);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
      centerHandle.style.display = 'none';
      return;
    }
    const centerPercent = (left + right) / 2;

    const trackRect = rangeTrack.getBoundingClientRect();
    const wrapRect = rangeWrap.getBoundingClientRect();
    if (!trackRect || !wrapRect || !wrapRect.width) {
      centerHandle.style.display = 'none';
      return;
    }

    const thumbSize = getThumbSize();
    const usableWidth = Math.max(0, trackRect.width - thumbSize);
    const clampedPercent = Math.min(100, Math.max(0, centerPercent));
    const trackOffset = trackRect.left - wrapRect.left;
    const xInTrack = (thumbSize / 2) + (usableWidth * (clampedPercent / 100));
    const xInWrap = trackOffset + xInTrack;

    centerHandle.style.display = 'block';
    centerHandle.style.left = `${xInWrap}px`;
  }
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
    // Geometrically center the handle between the rendered start/end handles
    positionCenterHandle(startPercent, endPercent);
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

  // Fixed-length center dragging logic
  let centerDrag = null;
  function onCenterPointerDown(ev) {
    if (!rangeWrap || !Number.isFinite(state.N)) return;
    ev.preventDefault();
    try { centerHandle.setPointerCapture?.(ev.pointerId); } catch {}
    const rect = rangeWrap.getBoundingClientRect();
    const thumbSize = getThumbSize();
    const usableWidth = Math.max(1, rect.width - thumbSize);
    const total = Math.max(1, Math.floor(Number(state.N || 0)));
    const S = Number(state.startChunk || 0);
    const E = Number(state.chunk || 0);
    const L = Math.max(1, E - S);
    centerHandle.classList.add('dragging');
    centerDrag = {
      startX: ev.clientX,
      width: usableWidth,
      total,
      length: L,
      center: (S + E) / 2,
      pointerId: ev.pointerId,
      moved: false,
    };
    window.addEventListener('pointermove', onCenterPointerMove, { passive: false });
    window.addEventListener('pointerup', onCenterPointerUp);
    window.addEventListener('pointercancel', onCenterPointerUp);
  }

  function onCenterPointerMove(ev) {
    if (!centerDrag || ev.pointerId !== centerDrag.pointerId) return;
    ev.preventDefault();
    const dx = ev.clientX - centerDrag.startX;
    if (!centerDrag.moved && Math.abs(dx) > 1) centerDrag.moved = true;
    const unitsDelta = (dx / centerDrag.width) * centerDrag.total;
    const minC = centerDrag.length / 2;
    const maxC = centerDrag.total - (centerDrag.length / 2);
    let c = centerDrag.center + unitsDelta;
    if (c < minC) c = minC;
    if (c > maxC) c = maxC;
    let s = Math.round(c - (centerDrag.length / 2));
    if (s < 0) s = 0;
    let e = s + centerDrag.length;
    if (e > centerDrag.total) {
      e = centerDrag.total;
      s = e - centerDrag.length;
    }
    setSelection(s, e, 'center');
  }

  function onCenterPointerUp(ev) {
    if (!centerDrag || ev.pointerId !== centerDrag.pointerId) return;
    try { centerHandle.releasePointerCapture?.(ev.pointerId); } catch {}
    window.removeEventListener('pointermove', onCenterPointerMove);
    window.removeEventListener('pointerup', onCenterPointerUp);
    window.removeEventListener('pointercancel', onCenterPointerUp);
    centerHandle.classList.remove('dragging');
    centerDrag = null;
  }

  centerHandle.addEventListener('pointerdown', onCenterPointerDown);

  return {
    setSelection,
    handleSliderInput,
    updateProgressUI,
  };
}
