// Maintains the graph simulation and DOM bridge.

import {
  factsInRangeChar,
  factsInRangeInter,
  getCurrentRel,
  getCurrentSummary,
} from '../utils.js';
import {
  sim,
  ensureNode,
  removeNode,
  ensureEdge,
  rebuildEdgeList,
  reheatSimulation,
  stepPhysics,
  updateSimBoundsFromStage,
} from '../sim.js';
import {
  upsertNodeDom,
  deleteNodeDom,
  upsertEdgeDom,
  deleteEdgeDom,
  applyPositionsToDOM,
} from '../domGraph.js';
import { state } from './state.js';

export function createGraphController({ svg, stage, navigateTo }) {
  function updateGraphStructure() {
    const data = state.data;
    if (!data) return;
    const S = state.startChunk;
    const E = state.chunk;
    const base = state.base || 0;
    const startChunk = base + S;
    const chunk = base + E;
    const allChars = data.characters || [];
    const allInters = data.interactions || [];

    const visibleChars = allChars.filter((c) => factsInRangeChar(c, startChunk, chunk).length > 0);
    const seedMap = state.layout.size ? state.layout : new Map();
    const visibleIds = new Set(visibleChars.map((c) => c.id));
    for (const ch of visibleChars) {
      const seed = seedMap.get(ch.id);
      const n = ensureNode(ch.id, seed);
      const facts = factsInRangeChar(ch, startChunk, chunk);
      const baseRadius = 10;
      const scalePerSqrt = 4;
      const maxRadius = baseRadius + 26;
      const rawRadius = Math.min(maxRadius, baseRadius + Math.floor(scalePerSqrt * Math.sqrt(facts.length || 0)));
      n.rTarget = Math.max(2, (rawRadius / 5) * 2);
    }

    for (const id of Array.from(sim.nodes.keys())) {
      if (!visibleIds.has(id)) {
        removeNode(id);
        deleteNodeDom(id);
      }
    }

    const visibleEdges = [];
    for (const inter of allInters) {
      if (!visibleIds.has(inter.a_id) || !visibleIds.has(inter.b_id)) continue;
      const weight = factsInRangeInter(inter, startChunk, chunk).length;
      if (weight <= 0) continue;
      const rel = getCurrentRel(inter, (chunk || 0) - 1);
      visibleEdges.push({ id: inter.id, a: inter.a_id, b: inter.b_id, weight, score: rel.score });
    }
    const newEdgeIds = new Set();
    for (const e of visibleEdges) {
      ensureEdge(e.id, e.a, e.b, e.weight, e.score);
      newEdgeIds.add(e.id);
      upsertEdgeDom(e, {
        getTooltipText: (edgeId) => {
          const inter = (state.data.interactions || []).find((it) => it.id === edgeId) || {};
          const upTo = (state.base || 0) + Math.max(0, (state.chunk || 0) - 1);
          return getCurrentRel(inter, upTo).text || '';
        },
        onClick: (edgeId) => {
          navigateTo({ type: 'edge', id: edgeId }, { push: true });
        },
      });
    }
    for (const id of Array.from(sim.edges.keys())) {
      if (!newEdgeIds.has(id)) {
        sim.edges.delete(id);
        deleteEdgeDom(id);
      }
    }
    rebuildEdgeList();

    for (const ch of visibleChars) {
      const n = sim.nodes.get(ch.id);
      upsertNodeDom(n, ch.name, {
        getTooltipText: (nodeId) => {
          const char = (state.data.characters || []).find((c) => c.id === nodeId);
          const upTo = (state.base || 0) + Math.max(0, (state.chunk || 0) - 1);
          return char ? getCurrentSummary(char, upTo) : '';
        },
        onClick: (nodeId) => {
          navigateTo({ type: 'node', id: nodeId }, { push: true });
        },
      });
    }

    applyPositionsToDOM();
    if (state.selectedId && !visibleIds.has(state.selectedId)) {
      state.selectedId = null;
    }
    const visibleEdgeIds = new Set(visibleEdges.map((e) => e.id));
    if (state.selectedEdgeId && !visibleEdgeIds.has(state.selectedEdgeId)) {
      state.selectedEdgeId = null;
    }
    if (!state.selectedId && !state.selectedEdgeId && state.rememberedSelection) {
      if (state.rememberedSelection.type === 'node' && visibleIds.has(state.rememberedSelection.id)) {
        state.selectedId = state.rememberedSelection.id;
      } else if (state.rememberedSelection.type === 'edge' && visibleEdgeIds.has(state.rememberedSelection.id)) {
        state.selectedEdgeId = state.rememberedSelection.id;
      }
    }
    reheatSimulation();
  }

  function render() {
    if (state.data) updateGraphStructure();
  }

  function animate() {
    if (!sim.running) return;
    stepPhysics();
    applyPositionsToDOM();
    sim.raf = requestAnimationFrame(animate);
  }

  function ensureAnimation() {
    if (!sim.running) {
      sim.running = true;
      sim.raf = requestAnimationFrame(animate);
    }
  }

  function updateBounds() {
    updateSimBoundsFromStage(stage, svg);
  }

  return {
    render,
    ensureAnimation,
    updateBounds,
    reheat: reheatSimulation,
    applyPositionsToDOM,
  };
}
