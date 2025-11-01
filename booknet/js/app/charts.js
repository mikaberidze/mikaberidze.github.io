// Mini chart utilities shared by the sidebar views.

import { factsInRangeInter, positionTooltip } from '../utils.js';

function clearChart(el) {
  if (el) el.innerHTML = '';
}

function ensureSize(el, fallbackWidth = 260, fallbackHeight = 84) {
  const w = Math.max(40, Math.floor(el?.clientWidth || fallbackWidth));
  const h = Math.max(40, Math.floor(el?.clientHeight || fallbackHeight));
  return { w, h };
}

function buildBinMeta(startChunk, endChunk, binCount) {
  const S = Number(startChunk);
  const E = Number(endChunk);
  if (!Number.isFinite(S) || !Number.isFinite(E) || E <= S || !Number.isFinite(binCount) || binCount <= 0) {
    return [];
  }
  const span = E - S;
  const meta = [];
  for (let i = 0; i < binCount; i++) {
    const startPos = S + (span * i) / binCount;
    let endPos = S + (span * (i + 1)) / binCount;
    if (i === binCount - 1) endPos = E;
    let start = Math.floor(startPos);
    if (start < S) start = S;
    let end = Math.floor(endPos);
    if (end <= start) end = start + 1;
    if (end > E) end = E;
    const chunkIds = [];
    for (let chunk = start; chunk < end; chunk++) {
      if (chunk > 0) chunkIds.push(chunk);
    }
    if (!chunkIds.length && start > 0) chunkIds.push(start);
    meta.push({ start, end, chunkIds });
  }
  return meta;
}

export function renderHistogram(el, bins, options = {}) {
  if (!el) return;
  clearChart(el);
  const data = Array.isArray(bins) ? { bins } : (bins || {});
  const values = Array.isArray(data.bins) ? data.bins : [];
  const binMeta = Array.isArray(options.binMeta) ? options.binMeta : Array.isArray(data.binMeta) ? data.binMeta : null;
  const onActivate = typeof options.onBinActivate === 'function' ? options.onBinActivate : null;
  const { w, h } = ensureSize(el);
  const leftPad = 26;
  const rightPad = 6;
  const topPad = 6;
  const bottomPad = 12;
  const iw = Math.max(1, w - leftPad - rightPad);
  const ih = Math.max(1, h - topPad - bottomPad);
  const max = Math.max(1, Math.max(...values, 0));
  const n = Math.max(1, values.length || 1);
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
    const v = values[i] || 0;
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
    r.setAttribute('pointer-events', 'none');

    // Hover + click overlay covering full column, including zero-height bars
    const overlay = document.createElementNS(svg.namespaceURI, 'rect');
    overlay.setAttribute('x', String(x));
    overlay.setAttribute('y', String(topPad));
    overlay.setAttribute('width', String(barW));
    overlay.setAttribute('height', String(ih));
    overlay.setAttribute('fill', 'transparent');
    if (onActivate) overlay.style.cursor = 'pointer';

    // Hover: show bin's x-range in percentages
    const tip = document.getElementById('tooltip');
    const show = (ev) => {
      if (!tip) return;
      const xs = Number(options.xStartPct);
      const xe = Number(options.xEndPct);
      if (!Number.isFinite(xs) || !Number.isFinite(xe)) return;
      const left = xs + (i / n) * (xe - xs);
      const right = xs + ((i + 1) / n) * (xe - xs);
      const fmtPct = (v) => `${Math.round(Math.max(0, Math.min(100, v)))}%`;
      tip.textContent = `${fmtPct(left)}–${fmtPct(right)}`;
      tip.style.opacity = '1';
      try { positionTooltip(tip, ev.clientX, ev.clientY); } catch {}
    };
    const hide = () => { if (tip) tip.style.opacity = '0'; };
    overlay.addEventListener('mouseenter', show);
    overlay.addEventListener('mousemove', show);
    overlay.addEventListener('mouseleave', hide);
    if (onActivate) {
      overlay.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const meta = binMeta?.[i] || data.binMeta?.[i] || null;
        const chunkIds = Array.isArray(meta?.chunkIds) ? meta.chunkIds : null;
        onActivate({
          index: i,
          value: v,
          count: v,
          meta,
          chunkIds,
        }, ev);
      });
    }
    svg.appendChild(r);
    svg.appendChild(overlay);
  }

  el.appendChild(svg);
}

// Render a stacked histogram with two series per bin.
// `bottomBins` typically represents introductions (darker),
// and `topBins` represents the remaining facts (lighter on top).
export function renderStackedHistogram(el, bottomBins, topBins, options = {}) {
  if (!el) return;
  clearChart(el);
  const bottom = Array.isArray(bottomBins) ? bottomBins : (bottomBins?.bins || []);
  const top = Array.isArray(topBins) ? topBins : (topBins?.bins || []);
  const binMeta = Array.isArray(options.binMeta) ? options.binMeta : Array.isArray(bottomBins?.binMeta) ? bottomBins.binMeta : Array.isArray(topBins?.binMeta) ? topBins.binMeta : null;
  const onActivate = typeof options.onBinActivate === 'function' ? options.onBinActivate : null;
  const { w, h } = ensureSize(el);
  const leftPad = 26;
  const rightPad = 6;
  const topPad = 6;
  const bottomPad = 12;
  const iw = Math.max(1, w - leftPad - rightPad);
  const ih = Math.max(1, h - topPad - bottomPad);
  const n = Math.max(1, Math.max(bottom.length || 0, top.length || 0));
  const gap = Math.min(2, Math.floor(iw / (n * 10)));
  const barW = Math.max(1, Math.floor((iw - gap * (n - 1)) / n));

  const totals = new Array(n).fill(0).map((_, i) => (Number(bottom[i] || 0) + Number(top[i] || 0)));
  const max = Math.max(1, Math.max(...totals, 0));

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

  // Color helpers
  const parseHex = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return [59, 130, 246]; // fallback #3b82f6
    return [
      parseInt(m[1].slice(0, 2), 16),
      parseInt(m[1].slice(2, 4), 16),
      parseInt(m[1].slice(4, 6), 16),
    ];
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const mix = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const base = parseHex(options.color || '#3b82f6');
  const dark = mix(base, [0, 0, 0], 0.12); // slightly darker for introductions
  const light = mix(base, [255, 255, 255], 0.18); // slightly lighter for rest
  const toHexColor = (rgb) => `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
  const bottomColor = toHexColor(dark);
  const topColor = toHexColor(light);

  // Bars (stacked)
  for (let i = 0; i < n; i++) {
    const b = Math.max(0, Number(bottom?.[i] || 0));
    const t = Math.max(0, Number(top?.[i] || 0));
    const total = Math.max(0, b + t);
    const totalH = Math.round((total / max) * ih) || 0;
    const bottomH = Math.round(((b / Math.max(1, max)) * ih)) || 0;
    const topH = Math.max(0, totalH - bottomH);
    const x = leftPad + i * (barW + gap);
    const yBottom = topPad + ih - bottomH;
    const yTop = yBottom - topH;

    // bottom segment
    const r1 = document.createElementNS(svg.namespaceURI, 'rect');
    r1.setAttribute('x', String(x));
    r1.setAttribute('y', String(yBottom));
    r1.setAttribute('width', String(barW));
    r1.setAttribute('height', String(Math.max(0, bottomH)));
    r1.setAttribute('fill', bottomColor);
    r1.setAttribute('opacity', '0.95');
    svg.appendChild(r1);

    // top segment
    const r2 = document.createElementNS(svg.namespaceURI, 'rect');
    r2.setAttribute('x', String(x));
    r2.setAttribute('y', String(yTop));
    r2.setAttribute('width', String(barW));
    r2.setAttribute('height', String(Math.max(0, topH)));
    r2.setAttribute('fill', topColor);
    r2.setAttribute('opacity', '0.95');
    svg.appendChild(r2);

    // Invisible overlay to unify hover target across both segments
    const overlay = document.createElementNS(svg.namespaceURI, 'rect');
    overlay.setAttribute('x', String(x));
    overlay.setAttribute('y', String(topPad));
    overlay.setAttribute('width', String(barW));
    overlay.setAttribute('height', String(ih));
    overlay.setAttribute('fill', 'transparent');
    if (onActivate) overlay.style.cursor = 'pointer';
    const tip = document.getElementById('tooltip');
    const show = (ev) => {
      if (!tip) return;
      const xs = Number(options.xStartPct);
      const xe = Number(options.xEndPct);
      if (!Number.isFinite(xs) || !Number.isFinite(xe)) return;
      const left = xs + (i / n) * (xe - xs);
      const right = xs + ((i + 1) / n) * (xe - xs);
      const fmtPct = (v) => `${Math.round(Math.max(0, Math.min(100, v)))}%`;
      tip.textContent = `${fmtPct(left)}–${fmtPct(right)}`;
      tip.style.opacity = '1';
      try { positionTooltip(tip, ev.clientX, ev.clientY); } catch {}
    };
    const hide = () => { if (tip) tip.style.opacity = '0'; };
    overlay.addEventListener('mouseenter', show);
    overlay.addEventListener('mousemove', show);
    overlay.addEventListener('mouseleave', hide);
    if (onActivate) {
      overlay.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const meta = binMeta?.[i] || bottomBins?.binMeta?.[i] || topBins?.binMeta?.[i] || null;
        const chunkIds = Array.isArray(meta?.chunkIds) ? meta.chunkIds : null;
        onActivate({
          index: i,
          value: total,
          count: total,
          bottom: b,
          top: t,
          meta,
          chunkIds,
        }, ev);
      });
    }
    svg.appendChild(overlay);
  }

  el.appendChild(svg);
}

export function computeStackedBinsFromFacts(facts, startChunk, endChunk, desiredBins = 20, isIntroFn) {
  const S = Number(startChunk);
  const E = Number(endChunk);
  if (!Number.isFinite(S) || !Number.isFinite(E) || E <= S) {
    return { introBins: [0], otherBins: [0], count: 1, binMeta: [] };
  }
  const range = E - S;
  const binCount = Math.max(1, Math.min(desiredBins, Math.floor(range)));
  const introBins = new Array(binCount).fill(0);
  const otherBins = new Array(binCount).fill(0);
  const denom = range || 1;
  const meta = buildBinMeta(S, E, binCount);
  const isIntro = typeof isIntroFn === 'function' ? isIntroFn : (() => false);
  for (const f of (facts || [])) {
    const c = Number(f?.chunk_id);
    if (!Number.isFinite(c) || c < S || c >= E) continue;
    const t = (c - S) / denom;
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(t * binCount)));
    if (isIntro(f)) introBins[idx]++;
    else otherBins[idx]++;
  }
  return { introBins, otherBins, count: binCount, binMeta: meta };
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

  // Markers: small circles at data points, matching line color
  const markerColor = options.color || '#10b981';
  const markerRadius = 2; // small and subtle
  for (let i = 0; i < points.length; i++) {
    const { x, y } = toXY(points[i]);
    const c = document.createElementNS(svg.namespaceURI, 'circle');
    c.setAttribute('cx', String(x));
    c.setAttribute('cy', String(y));
    c.setAttribute('r', String(markerRadius));
    c.setAttribute('fill', markerColor);
    // Avoid capturing pointer events from markers
    c.style.pointerEvents = 'none';
    svg.appendChild(c);
  }
  el.appendChild(svg);
}

export function computeHistogramBinsFromFacts(facts, startChunk, endChunk, desiredBins = 20) {
  const S = Number(startChunk);
  const E = Number(endChunk);
  if (!Number.isFinite(S) || !Number.isFinite(E) || E <= S) return { bins: [0], count: 1, binMeta: [] };
  const range = E - S;
  const binCount = Math.max(1, Math.min(desiredBins, Math.floor(range)));
  const bins = new Array(binCount).fill(0);
  const denom = range || 1;
  const meta = buildBinMeta(S, E, binCount);
  for (const f of (facts || [])) {
    const c = Number(f?.chunk_id);
    if (!Number.isFinite(c) || c < S || c >= E) continue;
    const t = (c - S) / denom;
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(t * binCount)));
    bins[idx]++;
  }
  return { bins, count: binCount, binMeta: meta };
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
