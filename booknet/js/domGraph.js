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
const LONG_PRESS_DELAY_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 12;

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
    const pressState = {
      timer: null,
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      suppressClick: false,
    };
    entry = { group, line, handlers, press: pressState };
    const getHandlers = () => entry.handlers || handlers;
    const cancelPress = (hide) => {
      if (pressState.timer) {
        clearTimeout(pressState.timer);
        pressState.timer = null;
      }
      const wasActive = pressState.active;
      pressState.active = false;
      pressState.pointerId = null;
      if (hide && tooltipEl) tooltipEl.style.opacity = '0';
      pressState.suppressClick = wasActive;
    };
    group.addEventListener('mousemove', (ev) => {
      const h = getHandlers();
      const text = h?.getTooltipText?.(e.id) || '';
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.style.opacity = '1';
      positionTooltip(tooltipEl, ev.clientX, ev.clientY);
    });
    group.addEventListener('mouseleave', () => { cancelPress(true); });
    group.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
      cancelPress(false);
      pressState.pointerId = ev.pointerId;
      pressState.startX = ev.clientX;
      pressState.startY = ev.clientY;
      pressState.timer = window.setTimeout(() => {
        pressState.timer = null;
        const h = getHandlers();
        const text = h?.getTooltipText?.(e.id) || '';
        if (!text) return;
        pressState.active = true;
        pressState.suppressClick = true;
        tooltipEl.textContent = text;
        tooltipEl.style.opacity = '1';
        positionTooltip(tooltipEl, pressState.startX, pressState.startY + 10);
      }, LONG_PRESS_DELAY_MS);
    });
    group.addEventListener('pointermove', (ev) => {
      if (pressState.pointerId == null || ev.pointerId !== pressState.pointerId) return;
      if (!pressState.timer && !pressState.active) return;
      const dx = Math.abs(ev.clientX - pressState.startX);
      const dy = Math.abs(ev.clientY - pressState.startY);
      if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
        cancelPress(true);
        return;
      }
      if (pressState.active) positionTooltip(tooltipEl, ev.clientX, ev.clientY + 10);
    });
    const finishPress = (ev) => {
      if (pressState.pointerId == null || ev.pointerId !== pressState.pointerId) return;
      cancelPress(true);
    };
    group.addEventListener('pointerup', finishPress);
    group.addEventListener('pointercancel', finishPress);
    group.addEventListener('click', (ev) => {
      if (pressState.suppressClick) {
        pressState.suppressClick = false;
        return;
      }
      const h = getHandlers();
      h?.onClick?.(e.id);
    });
    ensureLayers();
    edgesLayer.appendChild(group);
    dom.edges.set(edgeKey, entry);
  } else {
    entry.group.setAttribute('data-a', String(e.a));
    entry.group.setAttribute('data-b', String(e.b));
    entry.handlers = handlers;
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
    const pressState = {
      timer: null,
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      suppressClick: false,
    };
    const dragState = { pointerId: null };
    entry = { group, circle, label, handlers, press: pressState, drag: dragState };
    const getHandlers = () => entry.handlers || handlers;
    const cancelPress = (hide) => {
      if (pressState.timer) {
        clearTimeout(pressState.timer);
        pressState.timer = null;
      }
      const wasActive = pressState.active;
      pressState.active = false;
      pressState.pointerId = null;
      if (hide && tooltipEl) tooltipEl.style.opacity = '0';
      pressState.suppressClick = wasActive;
    };
    group.addEventListener('mousemove', (ev) => {
      const h = getHandlers();
      const text = h?.getTooltipText?.(n.id) || '';
      if (!text) return;
      tooltipEl.textContent = text;
      tooltipEl.style.opacity = '1';
      positionTooltip(tooltipEl, ev.clientX, ev.clientY);
    });
    group.addEventListener('mouseleave', () => { cancelPress(true); });
    group.addEventListener('click', () => {
      if (pressState.suppressClick) {
        pressState.suppressClick = false;
        return;
      }
      const h = getHandlers();
      h?.onClick?.(n.id);
    });

    // Drag + long-press behavior
    group.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      tooltipEl.style.opacity = '0';
      dragState.pointerId = ev.pointerId;
      try { group.setPointerCapture(ev.pointerId); } catch {}
      n.fixed = true;
      const pt = clientToSVG(svgEl, ev.clientX, ev.clientY);
      n.fx = pt.x; n.fy = pt.y; n.vx = 0; n.vy = 0;
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') {
        cancelPress(false);
        pressState.pointerId = ev.pointerId;
        pressState.startX = ev.clientX;
        pressState.startY = ev.clientY;
        pressState.timer = window.setTimeout(() => {
          pressState.timer = null;
          const h = getHandlers();
          const text = h?.getTooltipText?.(n.id) || '';
          if (!text) return;
          pressState.active = true;
          pressState.suppressClick = true;
          tooltipEl.textContent = text;
          tooltipEl.style.opacity = '1';
          positionTooltip(tooltipEl, pressState.startX, pressState.startY + 10);
        }, LONG_PRESS_DELAY_MS);
      } else {
        cancelPress(true);
      }
    });
    group.addEventListener('pointermove', (ev) => {
      if (dragState.pointerId != null && ev.pointerId === dragState.pointerId) {
        if (pressState.pointerId === ev.pointerId) {
          if (pressState.timer || pressState.active) {
            const dx = Math.abs(ev.clientX - pressState.startX);
            const dy = Math.abs(ev.clientY - pressState.startY);
            if (dx > LONG_PRESS_MOVE_TOLERANCE || dy > LONG_PRESS_MOVE_TOLERANCE) {
              cancelPress(true);
            } else if (pressState.active) {
              positionTooltip(tooltipEl, ev.clientX, ev.clientY + 10);
            }
          }
        }
        if (n.fixed) {
          const pt = clientToSVG(svgEl, ev.clientX, ev.clientY);
          n.fx = pt.x; n.fy = pt.y;
        }
      }
    });
    const endDrag = (ev) => {
      if (dragState.pointerId == null || ev.pointerId !== dragState.pointerId) return;
      cancelPress(true);
      dragState.pointerId = null;
      try { group.releasePointerCapture?.(ev.pointerId); } catch {}
      if (!n.fixed) return;
      n.fixed = false;
      reheatSimulation();
    };
    group.addEventListener('pointerup', endDrag);
    group.addEventListener('pointercancel', endDrag);

    ensureLayers();
    nodesLayer.appendChild(group);
    dom.nodes.set(nodeKey, entry);
  }
  if (labelText != null) entry.label.textContent = labelText;
  entry.handlers = handlers;
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
