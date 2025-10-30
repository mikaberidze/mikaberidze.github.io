// DOM graph management: layers, node/edge elements, and positioning

import { sim, reheatSimulation } from './sim.js';
import { colorForScore, clientToSVG, positionTooltip } from './utils.js';

export const dom = {
  nodes: new Map(), // id -> { group, circle, label }
  edges: new Map(), // id -> { group, line }
};

let svgEl = null;
let stageEl = null;
let tooltipEl = null;
let edgesLayer = null;
let nodesLayer = null;
let labelsLayer = null;
let highlightLayer = null;
let promotedEdgeId = null;
const promotedNodeIds = new Set();

export function initDomGraph({ svg, stage, tooltip }) {
  svgEl = svg; stageEl = stage; tooltipEl = tooltip;
  clearSVG();
}

function ensureLayers() {
  if (!edgesLayer || !nodesLayer || !labelsLayer || !highlightLayer) {
    edgesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    highlightLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgesLayer.setAttribute('data-layer', 'edges');
    nodesLayer.setAttribute('data-layer', 'nodes');
    labelsLayer.setAttribute('data-layer', 'labels');
    highlightLayer.setAttribute('data-layer', 'highlight');
    svgEl.appendChild(edgesLayer);
    svgEl.appendChild(nodesLayer);
    svgEl.appendChild(labelsLayer);
    svgEl.appendChild(highlightLayer);
  }
}

export function clearSVG() {
  if (!svgEl) return;
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  edgesLayer = null; nodesLayer = null; labelsLayer = null; highlightLayer = null;
  promotedEdgeId = null;
  promotedNodeIds.clear();
}

function edgeStrokeWidth(weight) {
  const w = Math.max(0, Math.sqrt(Number(weight || 0)));
  return Math.max(sim.params.edgeWidthMin, sim.params.edgeWidthMin + sim.params.edgeWidthCoeff * w);
}

export function upsertEdgeDom(e, handlers) {
  const edgeKey = String(e.id);
  let entry = dom.edges.get(edgeKey);
  if (!entry) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('edge');
    group.setAttribute('data-id', edgeKey);
    group.setAttribute('data-a', String(e.a));
    group.setAttribute('data-b', String(e.b));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.style.stroke = colorForScore(e.score);
    line.style.strokeWidth = `${edgeStrokeWidth(e.weight)}px`;
    group.appendChild(line);
    group.addEventListener('mousemove', (ev) => {
      const text = handlers?.getTooltipText?.(e.id) || '';
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.style.opacity = '1';
      positionTooltip(tooltipEl, ev.clientX, ev.clientY);
    });
    group.addEventListener('mouseleave', () => { tooltipEl.style.opacity = '0'; });
    group.addEventListener('click', () => { handlers?.onClick?.(e.id); });
    ensureLayers();
    edgesLayer.appendChild(group);
    entry = { group, line };
    dom.edges.set(edgeKey, entry);
  } else {
    entry.group.setAttribute('data-a', String(e.a));
    entry.group.setAttribute('data-b', String(e.b));
  }
  entry.line.style.stroke = colorForScore(e.score);
  entry.line.style.strokeWidth = `${edgeStrokeWidth(e.weight)}px`;
  return entry;
}

export function deleteEdgeDom(id) {
  const key = String(id);
  const entry = dom.edges.get(key);
  if (entry) {
    if (promotedEdgeId === key) demoteEdge(key);
    if (entry.group && entry.group.parentNode) entry.group.parentNode.removeChild(entry.group);
    dom.edges.delete(key);
  }
}

function promoteNode(id) {
  ensureLayers();
  const key = String(id);
  const entry = dom.nodes.get(key);
  if (!entry) return;
  if (entry.group && entry.group.parentNode !== highlightLayer) {
    highlightLayer.appendChild(entry.group);
  }
  if (entry.label && entry.label.parentNode !== highlightLayer) {
    highlightLayer.appendChild(entry.label);
  }
  promotedNodeIds.add(key);
}

function demoteNode(id) {
  const key = String(id);
  if (!promotedNodeIds.has(key)) return;
  const entry = dom.nodes.get(key);
  if (!entry) {
    promotedNodeIds.delete(key);
    return;
  }
  ensureLayers();
  if (entry.group && entry.group.parentNode === highlightLayer) nodesLayer.appendChild(entry.group);
  if (entry.label && entry.label.parentNode === highlightLayer) labelsLayer.appendChild(entry.label);
  promotedNodeIds.delete(key);
}

function promoteEdge(id) {
  ensureLayers();
  const edgeId = String(id);
  if (promotedEdgeId && promotedEdgeId !== edgeId) demoteEdge(promotedEdgeId);
  const entry = dom.edges.get(edgeId);
  if (!entry || !entry.group) return;
  if (entry.group.parentNode !== highlightLayer) highlightLayer.appendChild(entry.group);
  promotedEdgeId = edgeId;
  const a = entry.group.getAttribute('data-a');
  const b = entry.group.getAttribute('data-b');
  if (a != null) promoteNode(a);
  if (b != null) promoteNode(b);
}

function demoteEdge(id) {
  const edgeId = String(id);
  const entry = dom.edges.get(edgeId);
  if (!entry) {
    if (promotedEdgeId === edgeId) promotedEdgeId = null;
    return;
  }
  ensureLayers();
  if (entry.group && entry.group.parentNode === highlightLayer) edgesLayer.appendChild(entry.group);
  if (promotedEdgeId === edgeId) promotedEdgeId = null;
  const a = entry.group?.getAttribute('data-a');
  const b = entry.group?.getAttribute('data-b');
  if (a != null) demoteNode(a);
  if (b != null) demoteNode(b);
}

export function upsertNodeDom(n, labelText, handlers) {
  const nodeKey = String(n.id);
  let entry = dom.nodes.get(nodeKey);
  const radius = Math.max(2, n.r || 2);
  if (!entry) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.classList.add('node');
    group.setAttribute('data-id', nodeKey);
    group.style.touchAction = 'none';
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', String(radius));
    group.appendChild(circle);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.textContent = labelText || '';
    label.style.pointerEvents = 'none';
    ensureLayers();
    labelsLayer.appendChild(label);

    group.addEventListener('mousemove', (ev) => {
      const text = handlers?.getTooltipText?.(n.id) || '';
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.style.opacity = '1';
      positionTooltip(tooltipEl, ev.clientX, ev.clientY);
    });
    group.addEventListener('mouseleave', () => { tooltipEl.style.opacity = '0'; });
    group.addEventListener('click', () => { handlers?.onClick?.(n.id); });

    // Drag behavior
    group.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      group.setPointerCapture(ev.pointerId);
      n.fixed = true;
      const pt = clientToSVG(svgEl, ev.clientX, ev.clientY);
      n.fx = pt.x; n.fy = pt.y; n.vx = 0; n.vy = 0;
    });
    group.addEventListener('pointermove', (ev) => {
      if (!n.fixed) return;
      const pt = clientToSVG(svgEl, ev.clientX, ev.clientY);
      n.fx = pt.x; n.fy = pt.y;
    });
    const endDrag = () => {
      if (!n.fixed) return;
      n.fixed = false;
      reheatSimulation();
    };
    group.addEventListener('pointerup', endDrag);
    group.addEventListener('pointercancel', endDrag);

    ensureLayers();
    nodesLayer.appendChild(group);
    entry = { group, circle, label };
    dom.nodes.set(nodeKey, entry);
  }
  if (labelText != null) entry.label.textContent = labelText;
  return entry;
}

export function deleteNodeDom(id) {
  const key = String(id);
  const entry = dom.nodes.get(key);
  if (entry) {
    if (promotedNodeIds.has(key)) demoteNode(key);
    if (entry.group && entry.group.parentNode) entry.group.parentNode.removeChild(entry.group);
    if (entry.label && entry.label.parentNode) entry.label.parentNode.removeChild(entry.label);
    dom.nodes.delete(key);
  }
}

// Highlight a node by toggling a CSS class on its group
export function setNodeHighlight(id, on) {
  const entry = dom.nodes.get(String(id));
  if (!entry) return;
  if (on) entry.group.classList.add('highlight');
  else entry.group.classList.remove('highlight');
}

// Highlight an edge and/or bring it to the front of the edges layer
export function setEdgeHighlight(id, on) {
  const key = String(id);
  const entry = dom.edges.get(key);
  if (!entry) return;
  if (on) {
    entry.group.classList.add('highlight');
    promoteEdge(key);
  } else {
    entry.group.classList.remove('highlight');
    if (promotedEdgeId === key) demoteEdge(key);
  }
}

export function bringEdgeToFront(id) {
  promoteEdge(String(id));
}

export function applyPositionsToDOM() {
  for (const e of sim.edgeList) {
    const a = sim.nodes.get(e.a);
    const b = sim.nodes.get(e.b);
    const entry = dom.edges.get(String(e.id));
    if (!a || !b || !entry) continue;
    entry.line.setAttribute('x1', a.x);
    entry.line.setAttribute('y1', a.y);
    entry.line.setAttribute('x2', b.x);
    entry.line.setAttribute('y2', b.y);
  }
  for (const n of sim.nodes.values()) {
    const entry = dom.nodes.get(String(n.id));
    if (!entry) continue;
    const r = Math.max(2, n.r);
    entry.circle.setAttribute('cx', n.x);
    entry.circle.setAttribute('cy', n.y);
    entry.circle.setAttribute('r', String(r));
    entry.label.setAttribute('x', n.x + r + sim.params.labelDx);
    entry.label.setAttribute('y', n.y + sim.params.labelDy);
  }
}
