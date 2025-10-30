// Lightweight physics simulation for force-directed layout

export const sim = {
  nodes: new Map(), // id -> { id, x, y, vx, vy, fixed, fx, fy, r, rTarget }
  edges: new Map(), // id -> { id, a, b, weight, score }
  edgeList: [],
  params: {
    linkStrengthBase: 0.02,
    linkStrengthWeightCoeff: 0.0,
    chargeStrength: 30000,
    chargeNodeFactor: 0.1,
    chargeSoftening: 25,
    centerStrength: 0.01,
    damping: 0.94,
    dt: 0.02,
    maxSpeed: 10.0,
    wallStrength: 0.16,
    boundaryRadiusScale: 0.45,
    edgeWidthMin: 0.75,
    edgeWidthCoeff: 1.6,
    labelDx: 6,
    labelDy: 4,
  },
  bbox: null,
  center: { x: 0, y: 0, R: 0 },
  running: false,
  raf: null,
};

export function updateSimBoundsFromStage(stageEl, svgEl) {
  const hadBounds = !!sim.bbox;
  const prevCenterX = sim.center.x;
  const prevCenterY = sim.center.y;
  const bbox = stageEl.getBoundingClientRect();
  sim.bbox = bbox;
  const nextCenterX = bbox.width / 2;
  const nextCenterY = bbox.height / 2;
  if (hadBounds) {
    const dx = nextCenterX - prevCenterX;
    const dy = nextCenterY - prevCenterY;
    if (dx || dy) {
      for (const node of sim.nodes.values()) {
        node.x += dx;
        node.y += dy;
        if (node.fixed) {
          node.fx += dx;
          node.fy += dy;
        }
      }
    }
  }
  sim.center.x = nextCenterX;
  sim.center.y = nextCenterY;
  sim.center.R = Math.min(bbox.width, bbox.height) * sim.params.boundaryRadiusScale;
  svgEl.setAttribute('viewBox', `0 0 ${bbox.width} ${bbox.height}`);
}

export function ensureNode(id, seedPos) {
  let n = sim.nodes.get(id);
  if (!n) {
    const x = seedPos?.x ?? (sim.center.x + (Math.random() - 0.5) * 10);
    const y = seedPos?.y ?? (sim.center.y + (Math.random() - 0.5) * 10);
    n = { id, x, y, vx: 0, vy: 0, fixed: false, fx: 0, fy: 0, r: 2, rTarget: 2 };
    sim.nodes.set(id, n);
  }
  return n;
}

export function removeNode(id) { sim.nodes.delete(id); }

export function ensureEdge(edgeId, aId, bId, weight, score) {
  let e = sim.edges.get(edgeId);
  if (!e) {
    e = { id: edgeId, a: aId, b: bId, weight: Number(weight || 0), score: Number(score || 0) };
    sim.edges.set(edgeId, e);
  } else {
    e.a = aId; e.b = bId; e.weight = Number(weight || 0); e.score = Number(score || 0);
  }
  return e;
}

export function rebuildEdgeList() {
  sim.edgeList = Array.from(sim.edges.values());
}

export function reheatSimulation() {
  for (const n of sim.nodes.values()) {
    n.vx += (Math.random() - 0.5) * 0.5;
    n.vy += (Math.random() - 0.5) * 0.5;
  }
}

export function stepPhysics() {
  const { linkStrengthBase, chargeStrength, chargeNodeFactor, chargeSoftening, centerStrength, damping, dt, maxSpeed, wallStrength } = sim.params;

  // Spring forces
  for (const e of sim.edgeList) {
    const a = sim.nodes.get(e.a);
    const b = sim.nodes.get(e.b);
    if (!a || !b) continue;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dist = Math.hypot(dx, dy) || 0.0001;
    const ux = dx / dist; const uy = dy / dist;
    const w = Math.max(0, Math.sqrt(e.weight || 0));
    const k = linkStrengthBase * (1 + sim.params.linkStrengthWeightCoeff * w);
    const f = k * dist;
    const fx = f * ux;
    const fy = f * uy;
    if (!a.fixed) { a.vx += fx * dt; a.vy += fy * dt; }
    if (!b.fixed) { b.vx -= fx * dt; b.vy -= fy * dt; }
  }

  // Repulsion (naive O(n^2))
  const nodesArr = Array.from(sim.nodes.values());
  const N = nodesArr.length;
  if (N > 1) {
    const charge = chargeStrength / Math.max(1, Math.sqrt(N));
    for (let i = 0; i < N; i++) {
      const a = nodesArr[i];
      for (let j = i + 1; j < N; j++) {
        const b = nodesArr[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy + chargeSoftening;
        const dist = Math.sqrt(d2);
        const ux = dx / dist; const uy = dy / dist;
        const ra = Math.max(2, a.r);
        const rb = Math.max(2, b.r);
        const q = (1 + chargeNodeFactor * ra) * (1 + chargeNodeFactor * rb);
        const f = (charge * q) / d2;
        const fx = f * ux;
        const fy = f * uy;
        if (!a.fixed) { a.vx -= fx * dt; a.vy -= fy * dt; }
        if (!b.fixed) { b.vx += fx * dt; b.vy += fy * dt; }
      }
    }
  }

  // Centering + boundary
  const cx = sim.center.x, cy = sim.center.y, R = sim.center.R;
  for (const n of sim.nodes.values()) {
    if (!n.fixed) {
      n.vx += (cx - n.x) * centerStrength * dt;
      n.vy += (cy - n.y) * centerStrength * dt;
    }
    const dx = n.x - cx;
    const dy = n.y - cy;
    const r = Math.hypot(dx, dy) || 0.0001;
    if (r > R) {
      const over = r - R;
      const ux = dx / r, uy = dy / r;
      if (!n.fixed) {
        n.vx -= ux * over * wallStrength * dt;
        n.vy -= uy * over * wallStrength * dt;
      }
      const clampR = R + Math.min(over, 5);
      n.x = cx + ux * clampR;
      n.y = cy + uy * clampR;
    }
  }

  // Integrate
  for (const n of sim.nodes.values()) {
    if (n.fixed) {
      n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0;
    } else {
      n.vx *= damping; n.vy *= damping;
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > maxSpeed) {
        const s = maxSpeed / (sp || 0.0001);
        n.vx *= s; n.vy *= s;
      }
      n.x += n.vx; n.y += n.vy;
    }
    if (isFinite(n.rTarget)) n.r += (n.rTarget - n.r) * 0.2;
  }
}
