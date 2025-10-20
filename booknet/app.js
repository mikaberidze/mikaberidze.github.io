// Character Network Viewer (facts + summaries)
(function () {
  const DATA_URL = './data/character_network.json';

  const state = {
    data: null, // { maxChunk, characters: [...], interactions: [...] }
    percent: 0,
    chunk: 0,
    selectedId: null,       // character id
    selectedEdgeId: null,   // 'a|b'
    layout: new Map(), // id -> {x,y} (initial seeding only)
  };

  // Elements
  const svg = document.getElementById('network');
  const stage = document.getElementById('stage');
  const tooltip = document.getElementById('tooltip');
  // Dynamic badge in the top-left of the stage to show source name
  const sourceBadge = document.createElement('div');
  sourceBadge.id = 'sourceBadge';
  // minimal inline styles to avoid touching index.html
  Object.assign(sourceBadge.style, {
    position: 'absolute',
    top: '8px',
    left: '8px',
    background: 'rgba(17,24,39,0.85)', // gray-900
    color: '#f9fafb',                  // gray-50
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1',
    pointerEvents: 'none',
    zIndex: 10,
  });
  stage.appendChild(sourceBadge);
  const progressSlider = document.getElementById('progressSlider');
  const progressLabel = document.getElementById('progressLabel');
  const sidebarHint = document.getElementById('sidebarHint');
  const sidebarTitle = document.getElementById('sidebarTitle');
  const charPanel = document.getElementById('charPanel');
  const charHeader = document.getElementById('charHeader');
  const charStatus = document.getElementById('charStatus');
  const eventList = document.getElementById('eventList');
  const evidenceBox = document.getElementById('evidenceBox');

  const interPanel = document.getElementById('interPanel');
  const interHeader = document.getElementById('interHeader');
  const interStatus = document.getElementById('interStatus');
  const interEventList = document.getElementById('interEventList');
  const interEvidenceBox = document.getElementById('interEvidenceBox');

  function getCurrentSummary(char, upToChunk) {
    const list = Array.isArray(char.summaries) ? char.summaries.slice().sort((a,b) => a.chunk_id - b.chunk_id) : [];
    let cur = list.length ? list[0].text : `${char.name}`;
    for (const s of list) {
      if (upToChunk != null && s.chunk_id > upToChunk) break;
      cur = s.text;
    }
    return cur;
  }

  function factsUpTo(char, upToChunk) {
    const facts = Array.isArray(char.facts) ? char.facts : [];
    return facts.filter(f => upToChunk == null || (f.chunk_id != null && f.chunk_id <= upToChunk));
  }

  function getCurrentRel(inter, upToChunk) {
    const list = Array.isArray(inter.summaries) ? inter.summaries.slice().sort((a,b) => a.chunk_id - b.chunk_id) : [];
    let cur = { text: `${inter.a_name} • ${inter.b_name}`, score: 0 };
    for (const s of list) {
      if (upToChunk != null && s.chunk_id > upToChunk) break;
      cur = { text: s.text, score: Number(s.score || 0) };
    }
    return cur;
  }

  function factsUpToInter(inter, upToChunk) {
    const facts = Array.isArray(inter.facts) ? inter.facts : [];
    return facts.filter(f => upToChunk == null || (f.chunk_id != null && f.chunk_id <= upToChunk));
  }

  function colorForScore(score) {
    // Clamp
    const s = Math.max(-1, Math.min(1, Number(score || 0)));
    // Colors: red (#ef4444), gray (#9ca3af), blue (#3b82f6)
    const red = [0xef, 0x44, 0x44];
    const gray = [0x9c, 0xa3, 0xaf];
    const blue = [0x3b, 0x82, 0xf6];
    const mix = (a, b, t) => [
      Math.round(a[0] + (b[0]-a[0])*t),
      Math.round(a[1] + (b[1]-a[1])*t),
      Math.round(a[2] + (b[2]-a[2])*t),
    ];
    let c;
    if (s <= 0) {
      // -1 -> 0 : red -> gray
      const t = (s + 1) / 1; // s=-1 => 0, s=0 => 1
      c = mix(red, gray, t);
    } else {
      // 0 -> +1 : gray -> blue
      const t = s / 1; // s=0 => 0, s=1 => 1
      c = mix(gray, blue, t);
    }
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  // Layout: deterministic phyllotaxis pattern based on index (used as initial seed)
  function computeLayout(characters) {
    const bbox = stage.getBoundingClientRect();
    const w = bbox.width, h = bbox.height;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.43;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    const sorted = [...characters].sort((a,b) => a.name.localeCompare(b.name));
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
    state.layout = map;
  }

  function clearSVG() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    edgesLayer = null; nodesLayer = null;
  }

  // Layered groups so edges stay behind nodes
  let edgesLayer = null;
  let nodesLayer = null;
  function ensureLayers() {
    if (!edgesLayer || !nodesLayer) {
      edgesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      nodesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      edgesLayer.setAttribute('data-layer', 'edges');
      nodesLayer.setAttribute('data-layer', 'nodes');
      svg.appendChild(edgesLayer);
      svg.appendChild(nodesLayer);
    }
  }

  // --- Physics simulation (lightweight, D3-like) ---
  const sim = {
    nodes: new Map(), // id -> { id, x, y, vx, vy, fixed, fx, fy, r, rTarget }
    edges: new Map(), // id -> { id, a, b, weight, score }
    edgeList: [],     // cache array for iteration
    params: {
      linkStrengthBase: 0.03,
      linkLengthBase: 140,
      linkLengthWeightFactor: 0.3,  // higher weight => shorter rest length
      chargeStrength: 9000,         // further increased repulsion factor
      centerStrength: 0.005,        // gentler centering to avoid bunching
      damping: 0.86,
      dt: 0.02,
      maxSpeed: 4.0,
      wallStrength: 0.16,           // soft boundary strength
      boundaryRadiusScale: 0.52,    // allow a bit more spread
    },
    bbox: null,
    center: { x: 0, y: 0, R: 0 },
    running: false,
    raf: null,
  };

  function updateSimBoundsFromStage() {
    const bbox = stage.getBoundingClientRect();
    sim.bbox = bbox;
    sim.center.x = bbox.width / 2;
    sim.center.y = bbox.height / 2;
    sim.center.R = Math.min(bbox.width, bbox.height) * sim.params.boundaryRadiusScale;
    svg.setAttribute('viewBox', `0 0 ${bbox.width} ${bbox.height}`);
  }

  function ensureNode(id, seedPos) {
    let n = sim.nodes.get(id);
    if (!n) {
      const x = seedPos?.x ?? (sim.center.x + (Math.random() - 0.5) * 10);
      const y = seedPos?.y ?? (sim.center.y + (Math.random() - 0.5) * 10);
      n = { id, x, y, vx: 0, vy: 0, fixed: false, fx: 0, fy: 0, r: 10, rTarget: 10 };
      sim.nodes.set(id, n);
    }
    return n;
  }

  function removeNode(id) {
    sim.nodes.delete(id);
  }

  function ensureEdge(edgeId, aId, bId, weight, score) {
    let e = sim.edges.get(edgeId);
    if (!e) {
      e = { id: edgeId, a: aId, b: bId, weight: Number(weight || 0), score: Number(score || 0) };
      sim.edges.set(edgeId, e);
    } else {
      e.a = aId; e.b = bId; e.weight = Number(weight || 0); e.score = Number(score || 0);
    }
    return e;
  }

  function rebuildEdgeList() {
    sim.edgeList = Array.from(sim.edges.values());
  }

  function reheatSimulation() {
    // Nudge velocities slightly to help re-converge when structure changes
    for (const n of sim.nodes.values()) {
      n.vx += (Math.random() - 0.5) * 0.5;
      n.vy += (Math.random() - 0.5) * 0.5;
    }
  }

  function stepPhysics() {
    const { linkStrengthBase, linkLengthBase, linkLengthWeightFactor, chargeStrength, centerStrength, damping, dt, maxSpeed, wallStrength } = sim.params;

    // Reset accelerations are implicit since we directly update velocities with forces per-tick

    // Link (spring) forces
    for (const e of sim.edgeList) {
      const a = sim.nodes.get(e.a);
      const b = sim.nodes.get(e.b);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy) || 0.0001;
      const ux = dx / dist; const uy = dy / dist;
      const w = Math.max(0, Math.sqrt(e.weight || 0));
      const k = linkStrengthBase * (1 + 0.8 * w); // stronger for heavier edges
      const L = linkLengthBase / (1 + linkLengthWeightFactor * w);
      const f = k * (dist - L);
      const fx = f * ux;
      const fy = f * uy;
      if (!a.fixed) { a.vx += fx * dt; a.vy += fy * dt; }
      if (!b.fixed) { b.vx -= fx * dt; b.vy -= fy * dt; }
    }

    // Charge (repulsion) forces — naive O(n^2), acceptable for modest N
    const nodesArr = Array.from(sim.nodes.values());
    const N = nodesArr.length;
    if (N > 1) {
      // Reduce charge for large graphs to keep stability
      const charge = chargeStrength / Math.max(1, Math.sqrt(N));
      for (let i = 0; i < N; i++) {
        const a = nodesArr[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodesArr[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx*dx + dy*dy + 25; // softening
          const dist = Math.sqrt(d2);
          const ux = dx / dist; const uy = dy / dist;
          const f = (charge) / d2; // inverse-square
          const fx = f * ux;
          const fy = f * uy;
          if (!a.fixed) { a.vx -= fx * dt; a.vy -= fy * dt; }
          if (!b.fixed) { b.vx += fx * dt; b.vy += fy * dt; }
        }
      }
    }

    // Centering and soft circular boundary (radial wall)
    const cx = sim.center.x, cy = sim.center.y, R = sim.center.R;
    for (const n of sim.nodes.values()) {
      if (!n.fixed) {
        // weak centering
        n.vx += (cx - n.x) * centerStrength * dt;
        n.vy += (cy - n.y) * centerStrength * dt;
      }
      // Soft wall if outside boundary
      const dx = n.x - cx;
      const dy = n.y - cy;
      const r = Math.hypot(dx, dy) || 0.0001;
      if (r > R) {
        const over = r - R;
        const ux = dx / r, uy = dy / r;
        // push back inward
        if (!n.fixed) {
          n.vx -= ux * over * wallStrength * dt;
          n.vy -= uy * over * wallStrength * dt;
        }
        // also clamp position softly
        const clampR = R + Math.min(over, 5);
        n.x = cx + ux * clampR;
        n.y = cy + uy * clampR;
      }
    }

    // Integrate velocities -> positions with damping and speed cap
    for (const n of sim.nodes.values()) {
      if (n.fixed) {
        n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0;
      } else {
        n.vx *= damping; n.vy *= damping;
        // cap speed
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > maxSpeed) {
          const s = maxSpeed / (sp || 0.0001);
          n.vx *= s; n.vy *= s;
        }
        n.x += n.vx;
        n.y += n.vy;
      }
      // smooth radius towards target
      if (isFinite(n.rTarget)) n.r += (n.rTarget - n.r) * 0.2;
    }
  }

  // --- DOM graph management ---
  const dom = {
    nodes: new Map(), // id -> { group, circle, label }
    edges: new Map(), // id -> { group, line }
  };

  function upsertEdgeDom(e) {
    let entry = dom.edges.get(e.id);
    if (!entry) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('edge');
      group.setAttribute('data-id', e.id);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.style.stroke = colorForScore(e.score);
      line.style.strokeWidth = `${Math.max(1.5, 1.5 + 0.8 * Math.sqrt(e.weight || 0))}px`;
      group.appendChild(line);
      group.addEventListener('mousemove', (ev) => {
        const rel = getCurrentRel((state.data.interactions || []).find(it => it.id === e.id) || {}, state.chunk);
        tooltip.textContent = rel.text || '';
        tooltip.style.opacity = '1';
        positionTooltip(tooltip, ev.clientX, ev.clientY);
      });
      group.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
      group.addEventListener('click', () => { state.selectedEdgeId = e.id; state.selectedId = null; renderSidebar(); });
      ensureLayers();
      edgesLayer.appendChild(group);
      entry = { group, line };
      dom.edges.set(e.id, entry);
    }
    // update style for weight/score changes
    entry.line.style.stroke = colorForScore(e.score);
    entry.line.style.strokeWidth = `${Math.max(1.5, 1.5 + 0.8 * Math.sqrt(e.weight || 0))}px`;
    return entry;
  }

  function deleteEdgeDom(id) {
    const entry = dom.edges.get(id);
    if (entry) {
      if (entry.group && entry.group.parentNode) entry.group.parentNode.removeChild(entry.group);
      dom.edges.delete(id);
    }
  }

  function upsertNodeDom(n, labelText) {
    let entry = dom.nodes.get(n.id);
    const radius = Math.max(10, n.r || 10);
    if (!entry) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('node');
      group.setAttribute('data-id', n.id);
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', String(radius));
      group.appendChild(circle);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.textContent = labelText || '';
      group.appendChild(label);

      // Hover tooltip using summaries
      group.addEventListener('mousemove', (ev) => {
        const char = (state.data.characters || []).find(c => c.id === n.id);
        tooltip.textContent = char ? getCurrentSummary(char, state.chunk) : '';
        tooltip.style.opacity = '1';
        positionTooltip(tooltip, ev.clientX, ev.clientY);
      });
      group.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
      group.addEventListener('click', () => { state.selectedId = n.id; state.selectedEdgeId = null; renderSidebar(); });

      // Drag behavior (pointer events)
      group.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        group.setPointerCapture(ev.pointerId);
        n.fixed = true;
        const pt = clientToSVG(ev.clientX, ev.clientY);
        n.fx = pt.x; n.fy = pt.y; n.vx = 0; n.vy = 0;
      });
      group.addEventListener('pointermove', (ev) => {
        if (!n.fixed) return;
        const pt = clientToSVG(ev.clientX, ev.clientY);
        n.fx = pt.x; n.fy = pt.y;
      });
      const endDrag = (ev) => {
        if (!n.fixed) return;
        n.fixed = false;
        reheatSimulation();
      };
      group.addEventListener('pointerup', endDrag);
      group.addEventListener('pointercancel', endDrag);

      ensureLayers();
      nodesLayer.appendChild(group);
      entry = { group, circle, label };
      dom.nodes.set(n.id, entry);
    }
    // update label text if provided
    if (labelText != null) entry.label.textContent = labelText;
    return entry;
  }

  function deleteNodeDom(id) {
    const entry = dom.nodes.get(id);
    if (entry) {
      if (entry.group && entry.group.parentNode) entry.group.parentNode.removeChild(entry.group);
      dom.nodes.delete(id);
    }
  }

  function clientToSVG(clientX, clientY) {
    // since viewBox matches pixel bounds, direct offset works
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Computes which nodes/edges are visible at current chunk and updates sim + DOM
  function updateGraphStructure() {
    const data = state.data; if (!data) return;
    const chunk = state.chunk;
    const allChars = data.characters || [];
    const allInters = data.interactions || [];

    // Visible characters: first summary chunk <= slider chunk
    const visibleChars = allChars.filter(c => {
      const first = (c.summaries && c.summaries.length) ? Math.min(...c.summaries.map(s => s.chunk_id || 0)) : 0;
      return first <= chunk;
    });

    // Seed missing nodes (prefer previous phyllotaxis position)
    const seedMap = state.layout.size ? state.layout : new Map();
    const visibleIds = new Set(visibleChars.map(c => c.id));
    for (const ch of visibleChars) {
      const seed = seedMap.get(ch.id);
      const n = ensureNode(ch.id, seed);
      // update radius target based on facts up to chunk
      const facts = factsUpTo(ch, chunk);
      const baseRadius = 10, scalePerSqrt = 4, maxRadius = baseRadius + 26;
      const rTarget = Math.min(maxRadius, baseRadius + Math.floor(scalePerSqrt * Math.sqrt(facts.length || 0)));
      n.rTarget = rTarget;
    }
    // Remove nodes no longer visible
    for (const id of Array.from(sim.nodes.keys())) {
      if (!visibleIds.has(id)) {
        removeNode(id);
        deleteNodeDom(id);
      }
    }

    // Visible edges: first summary chunk <= slider chunk and endpoints visible
    const visibleEdges = [];
    for (const inter of allInters) {
      const first = (inter.summaries && inter.summaries.length) ? Math.min(...inter.summaries.map(s => s.chunk_id || 0)) : 0;
      if (first > chunk) continue;
      if (!visibleIds.has(inter.a_id) || !visibleIds.has(inter.b_id)) continue;
      const weight = factsUpToInter(inter, chunk).length;
      const rel = getCurrentRel(inter, chunk);
      visibleEdges.push({ id: inter.id, a: inter.a_id, b: inter.b_id, weight, score: rel.score });
    }

    const newEdgeIds = new Set();
    for (const e of visibleEdges) {
      ensureEdge(e.id, e.a, e.b, e.weight, e.score);
      newEdgeIds.add(e.id);
      upsertEdgeDom(e);
    }
    // Remove old edges
    for (const id of Array.from(sim.edges.keys())) {
      if (!newEdgeIds.has(id)) {
        sim.edges.delete(id);
        deleteEdgeDom(id);
      }
    }
    rebuildEdgeList();

    // Upsert DOM nodes with labels
    for (const ch of visibleChars) {
      const n = sim.nodes.get(ch.id);
      upsertNodeDom(n, ch.name);
    }
    // Position update immediately for new nodes
    applyPositionsToDOM();

    reheatSimulation();
  }

  function applyPositionsToDOM() {
    // Edges
    for (const e of sim.edgeList) {
      const a = sim.nodes.get(e.a);
      const b = sim.nodes.get(e.b);
      const entry = dom.edges.get(e.id);
      if (!a || !b || !entry) continue;
      entry.line.setAttribute('x1', a.x);
      entry.line.setAttribute('y1', a.y);
      entry.line.setAttribute('x2', b.x);
      entry.line.setAttribute('y2', b.y);
    }
    // Nodes
    for (const n of sim.nodes.values()) {
      const entry = dom.nodes.get(n.id);
      if (!entry) continue;
      const r = Math.max(2, n.r);
      entry.circle.setAttribute('cx', n.x);
      entry.circle.setAttribute('cy', n.y);
      entry.circle.setAttribute('r', String(r));
      entry.label.setAttribute('x', n.x + r + 6);
      entry.label.setAttribute('y', n.y + 4);
    }
  }

  function animate() {
    if (!sim.running) return;
    stepPhysics();
    applyPositionsToDOM();
    sim.raf = requestAnimationFrame(animate);
  }

  function positionTooltip(el, x, y) {
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

  // render() now just ensures DOM exists; positions are handled by simulation
  function render() {
    if (!state.data) return;
    updateGraphStructure();
  }

  function renderSidebar() {
    const data = state.data;
    if (!data) { charPanel.style.display = 'none'; interPanel.style.display = 'none'; sidebarHint.style.display = 'block'; if (sidebarTitle) sidebarTitle.textContent = 'Character Details'; return; }
    const chunk = state.chunk;

    // Character panel
    if (state.selectedId) {
      const id = state.selectedId;
      const ch = data.characters.find(c => c.id === id);
      if (!ch) return;
      sidebarHint.style.display = 'none';
      if (sidebarTitle) sidebarTitle.textContent = 'Character Details';
      interPanel.style.display = 'none';
      charPanel.style.display = 'block';
      charHeader.textContent = ch.name;
      charStatus.textContent = `Facts up to chunk ${chunk}: ${factsUpTo(ch, chunk).length}`;
      charStatus.style.color = '#374151';
      evidenceBox.style.display = 'none';
      eventList.innerHTML = '';
      const facts = factsUpTo(ch, chunk).sort((a,b) => (a.chunk_id - b.chunk_id) || (a.fact_id - b.fact_id));
      for (const f of facts) {
        const li = document.createElement('li');
        li.className = 'event-item';
        const title = document.createElement('div');
        title.textContent = `[${f.fact_id}] ${f.text}`;
        li.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = ch.name;
        li.appendChild(meta);
        li.addEventListener('mousemove', (e) => {
          tooltip.textContent = `Argument: ${f.argument || ''} (chunk ${f.chunk_id ?? '?'})`;
          tooltip.style.opacity = '1';
          positionTooltip(tooltip, e.clientX, e.clientY);
        });
        li.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
        // Open source text viewer at this chunk on click
        if (state.data && state.data.sourceName && typeof f.chunk_id === 'number') {
          li.style.cursor = 'pointer';
          li.title = 'Open source text at this chunk';
          li.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const url = `text_viewer.html?src=${encodeURIComponent(state.data.sourceName)}&chunk=${encodeURIComponent(f.chunk_id)}`;
            window.open(url, '_blank');
          });
        }
        eventList.appendChild(li);
      }
      return;
    }

    // Interaction panel
    if (state.selectedEdgeId) {
      const eId = state.selectedEdgeId;
      const inter = (data.interactions || []).find(it => it.id === eId);
      if (!inter) return;
      sidebarHint.style.display = 'none';
      if (sidebarTitle) sidebarTitle.textContent = 'Relationship Detail';
      charPanel.style.display = 'none';
      interPanel.style.display = 'block';
      const rel = getCurrentRel(inter, chunk);
      interHeader.textContent = `${inter.a_name} • ${inter.b_name}`;
      interStatus.textContent = `Facts up to chunk ${chunk}: ${factsUpToInter(inter, chunk).length} • Sentiment: ${rel.score.toFixed(2)}`;
      interStatus.style.color = '#374151';
      interEvidenceBox.style.display = 'none';
      interEventList.innerHTML = '';
      const facts = factsUpToInter(inter, chunk).sort((a,b) => (a.chunk_id - b.chunk_id) || (a.fact_id - b.fact_id));
      for (const f of facts) {
        const li = document.createElement('li');
        li.className = 'event-item';
        const title = document.createElement('div');
        title.textContent = `[${f.fact_id}] ${f.text}`;
        li.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `${inter.a_name} • ${inter.b_name}`;
        li.appendChild(meta);
        li.addEventListener('mousemove', (e) => {
          tooltip.textContent = `Evidence: ${f.evidence || ''} (chunk ${f.chunk_id ?? '?'})`;
          tooltip.style.opacity = '1';
          positionTooltip(tooltip, e.clientX, e.clientY);
        });
        li.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
        // Open source text viewer at this chunk on click
        if (state.data && state.data.sourceName && typeof f.chunk_id === 'number') {
          li.style.cursor = 'pointer';
          li.title = 'Open source text at this chunk';
          li.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const url = `text_viewer.html?src=${encodeURIComponent(state.data.sourceName)}&chunk=${encodeURIComponent(f.chunk_id)}`;
            window.open(url, '_blank');
          });
        }
        interEventList.appendChild(li);
      }
      return;
    }

    // Nothing selected
    charPanel.style.display = 'none';
    interPanel.style.display = 'none';
    sidebarHint.style.display = 'block';
    if (sidebarTitle) sidebarTitle.textContent = 'Character Details';
  }

  function updateProgressFromSlider() {
    if (!state.data) return;
    const p = Number(progressSlider.value);
    const maxChunk = state.data.maxChunk || 0;
    const chunk = Math.round((p / 100) * maxChunk);
    state.percent = p;
    state.chunk = chunk;
    progressLabel.textContent = `Progress: ${p}% • Chunk ${chunk}/${maxChunk}`;
    render(); // updates structure and weights
    renderSidebar();
  }

  function onResize() {
    if (!state.data) return;
    updateSimBoundsFromStage();
    // Keep seeds but do not recompute entire structure; just apply new bounds
    render();
  }

  async function init() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.data = data;
      // Update stage badge with source name if available
      if (data && data.sourceName) {
        sourceBadge.textContent = String(data.sourceName);
        sourceBadge.style.display = 'block';
      } else {
        sourceBadge.style.display = 'none';
      }
      state.percent = 0;
      state.chunk = 0;
      progressLabel.textContent = `Progress: 0% • Chunk 0/${data.maxChunk || 0}`;
      // Seed layout and physics bounds
      computeLayout(data.characters || []);
      updateSimBoundsFromStage();
      clearSVG();
      render();
      // start animation loop
      if (!sim.running) { sim.running = true; sim.raf = requestAnimationFrame(animate); }
    } catch (err) {
      console.error('Failed to load data:', err);
      sidebarHint.textContent = 'Could not load data. Run: python scripts/export_network_json.py then serve this folder via a local web server.';
    }
    progressSlider.addEventListener('input', updateProgressFromSlider);
    window.addEventListener('resize', onResize);
  }

  init();
})();
