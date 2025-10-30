// Mini chart utilities shared by the sidebar views.

import { factsInRangeInter } from '../utils.js';

function clearChart(el) {
  if (el) el.innerHTML = '';
}

function ensureSize(el, fallbackWidth = 260, fallbackHeight = 84) {
  const w = Math.max(40, Math.floor(el?.clientWidth || fallbackWidth));
  const h = Math.max(40, Math.floor(el?.clientHeight || fallbackHeight));
  return { w, h };
}

export function renderHistogram(el, bins, options = {}) {
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

  // X-axis min/max percentage ticks and label
  const xStartPct = Number(options.xStartPct);
  const xEndPct = Number(options.xEndPct);
  const fmtPct = (v) => `${Math.round(Math.max(0, Math.min(100, v)))}%`;
  const lblY = topPad + ih + 10;
  if (Number.isFinite(xStartPct)) {
    const xt = document.createElementNS(svg.namespaceURI, 'text');
    xt.setAttribute('x', String(leftPad));
    xt.setAttribute('y', String(lblY));
    xt.setAttribute('text-anchor', 'start');
    xt.setAttribute('font-size', '10');
    xt.setAttribute('fill', '#6b7280');
    xt.textContent = fmtPct(xStartPct);
    svg.appendChild(xt);
  }
  if (Number.isFinite(xEndPct)) {
    const xt = document.createElementNS(svg.namespaceURI, 'text');
    xt.setAttribute('x', String(leftPad + iw));
    xt.setAttribute('y', String(lblY));
    xt.setAttribute('text-anchor', 'end');
    xt.setAttribute('font-size', '10');
    xt.setAttribute('fill', '#6b7280');
    xt.textContent = fmtPct(xEndPct);
    svg.appendChild(xt);
  }
  if (options.xLabel) {
    const xl = document.createElementNS(svg.namespaceURI, 'text');
    xl.setAttribute('x', String(leftPad + iw / 2));
    xl.setAttribute('y', String(lblY));
    xl.setAttribute('text-anchor', 'middle');
    xl.setAttribute('font-size', '10');
    xl.setAttribute('fill', '#9ca3af');
    xl.textContent = String(options.xLabel);
    svg.appendChild(xl);
  }

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

export function renderSentimentLine(el, points, options = {}) {
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

  // X-axis min/max percentage ticks and label
  const xStartPct = Number(options.xStartPct);
  const xEndPct = Number(options.xEndPct);
  const fmtPct = (v) => `${Math.round(Math.max(0, Math.min(100, v)))}%`;
  const lblY = topPad + ih + 10;
  if (Number.isFinite(xStartPct)) {
    const xt = document.createElementNS(svg.namespaceURI, 'text');
    xt.setAttribute('x', String(leftPad));
    xt.setAttribute('y', String(lblY));
    xt.setAttribute('text-anchor', 'start');
    xt.setAttribute('font-size', '10');
    xt.setAttribute('fill', '#6b7280');
    xt.textContent = fmtPct(xStartPct);
    svg.appendChild(xt);
  }
  if (Number.isFinite(xEndPct)) {
    const xt = document.createElementNS(svg.namespaceURI, 'text');
    xt.setAttribute('x', String(leftPad + iw));
    xt.setAttribute('y', String(lblY));
    xt.setAttribute('text-anchor', 'end');
    xt.setAttribute('font-size', '10');
    xt.setAttribute('fill', '#6b7280');
    xt.textContent = fmtPct(xEndPct);
    svg.appendChild(xt);
  }
  if (options.xLabel) {
    const xl = document.createElementNS(svg.namespaceURI, 'text');
    xl.setAttribute('x', String(leftPad + iw / 2));
    xl.setAttribute('y', String(lblY));
    xl.setAttribute('text-anchor', 'middle');
    xl.setAttribute('font-size', '10');
    xl.setAttribute('fill', '#9ca3af');
    xl.textContent = String(options.xLabel);
    svg.appendChild(xl);
  }

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

export function computeHistogramBinsFromFacts(facts, startChunk, endChunk, desiredBins = 20) {
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

export function collectInteractionFactsForChar(interactions, charId, startChunk, endChunk) {
  const list = [];
  for (const inter of (interactions || [])) {
    if (inter.a_id !== charId && inter.b_id !== charId) continue;
    const facts = factsInRangeInter(inter, startChunk, endChunk);
    for (const f of facts) list.push(f);
  }
  return list;
}
