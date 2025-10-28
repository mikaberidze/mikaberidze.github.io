// Utility functions for summaries, filtering, colors, layout, and UI helpers

export function getCurrentSummary(char, upToChunk) {
  const list = Array.isArray(char?.summaries) ? char.summaries.slice().sort((a, b) => a.chunk_id - b.chunk_id) : [];
  let cur = list.length ? list[0].text : String(char?.name ?? '');
  for (const s of list) {
    if (upToChunk != null && s.chunk_id > upToChunk) break;
    cur = s.text;
  }
  return cur;
}

export function factsInRangeChar(char, startChunk, endChunk) {
  const facts = Array.isArray(char?.facts) ? char.facts : [];
  return facts.filter(f => {
    const c = f?.chunk_id;
    return (startChunk == null || c >= startChunk) && (endChunk == null || c < endChunk);
  });
}

export function getCurrentRel(inter, upToChunk) {
  const list = Array.isArray(inter?.summaries) ? inter.summaries.slice().sort((a, b) => a.chunk_id - b.chunk_id) : [];
  let cur = { text: `${inter?.a_name ?? ''} • ${inter?.b_name ?? ''}`, score: 0 };
  for (const s of list) {
    if (upToChunk != null && s.chunk_id > upToChunk) break;
    cur = { text: s.text, score: Number(s.score || 0) };
  }
  return cur;
}

export function factsInRangeInter(inter, startChunk, endChunk) {
  const facts = Array.isArray(inter?.facts) ? inter.facts : [];
  return facts.filter(f => {
    const c = f?.chunk_id;
    return (startChunk == null || c >= startChunk) && (endChunk == null || c < endChunk);
  });
}

export function colorForScore(score) {
  const s = Math.max(-1, Math.min(1, Number(score || 0)));
  const red = [0xef, 0x44, 0x44];   // -1
  const gray = [0x9c, 0xa3, 0xaf];  //  0
  const green = [0x10, 0xb9, 0x81]; // +1
  const mix = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  let c;
  if (s <= 0) {
    // Map [-1, 0] -> [0, 1] and mix red -> gray
    const t = s + 1;
    c = mix(red, gray, t);
  } else {
    // Map (0, 1] -> (0, 1] and mix gray -> green
    const t = s;
    c = mix(gray, green, t);
  }
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function computeLayout(characters, stageEl) {
  const bbox = stageEl.getBoundingClientRect();
  const w = bbox.width, h = bbox.height;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.43;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const sorted = [...(characters || [])].sort((a, b) => a.name.localeCompare(b.name));
  const map = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const ch = sorted[i];
    const t = i + 1;
    const r = R * Math.sqrt(t / sorted.length);
    const theta = t * goldenAngle;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    map.set(ch.id, { x, y });
  }
  return map;
}

export function clientToSVG(svgEl, clientX, clientY) {
  const rect = svgEl.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export function positionTooltip(el, x, y) {
  const pad = 12;
  el.style.left = `${x + pad}px`;
  el.style.top = `${y + 8}px`;
  const rect = el.getBoundingClientRect();
  let nx = rect.left, ny = rect.top;
  if (rect.right > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - rect.width - 8);
  if (rect.bottom > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - rect.height - 8);
  el.style.left = `${nx}px`;
  el.style.top = `${ny}px`;
}
