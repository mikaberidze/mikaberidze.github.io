// Sidebar rendering and interactions for characters and relationships.

import {
  getCurrentSummary,
  factsInRangeChar,
  getCurrentRel,
  factsInRangeInter,
  positionTooltip,
} from '../utils.js';
import {
  dom,
  setNodeHighlight,
  setEdgeHighlight,
  bringEdgeToFront,
} from '../domGraph.js';
import {
  renderHistogram,
  renderSentimentLine,
  computeHistogramBinsFromFacts,
  collectInteractionFactsForChar,
} from './charts.js';
import { state } from './state.js';

export function createSidebarRenderer({ elements, navigateTo, openTextDock, getTextViewerUrl }) {
  const {
    sidebarHint,
    sidebarTitle,
    browsePanel,
    browseStatus,
    browseList,
    charPanel,
    charHeader,
    charSummary,
    charTabs,
    tabFacts,
    tabRels,
    viewFacts,
    viewRels,
    charStatus,
    eventList,
    relList,
    charRelStatus,
    interPanel,
    interHeader,
    interSummary,
    interStatus,
    interEventList,
    tooltip,
    charFactHistEl,
    charInterHistEl,
    interFactHistEl,
    interSentChartEl,
  } = elements;

  let tabsInitialized = false;

  function clearNodeHighlights() {
    if (!dom || !dom.nodes) return;
    for (const entry of dom.nodes.values()) {
      if (entry?.group) entry.group.classList.remove('highlight');
    }
  }

  function appendEventItem(listEl, { titleText, metaText, hoverText, chunkId }) {
    if (!listEl) return;
    const li = document.createElement('li');
    li.className = 'event-item';
    const title = document.createElement('div');
    title.textContent = titleText || '';
    li.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = metaText || '';
    li.appendChild(meta);
    li.addEventListener('mousemove', (e) => {
      tooltip.textContent = hoverText || '';
      tooltip.style.opacity = '1';
      positionTooltip(tooltip, e.clientX, e.clientY);
    });
    li.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
    if (state.data && state.data.sourceName && typeof chunkId === 'number') {
      li.style.cursor = 'pointer';
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.metaKey || ev.ctrlKey) {
          const url = getTextViewerUrl?.(chunkId);
          if (url) window.open(url, '_blank');
          return;
        }
        openTextDock?.(chunkId);
      });
    }
    listEl.appendChild(li);
  }

  function ensureTabs() {
    if (tabsInitialized || !charTabs || !tabFacts || !tabRels || !viewFacts || !viewRels) return;
    const selectTab = (which) => {
      const isFacts = which === 'facts';
      tabFacts.setAttribute('aria-selected', isFacts ? 'true' : 'false');
      tabRels.setAttribute('aria-selected', isFacts ? 'false' : 'true');
      viewFacts.classList.toggle('active', isFacts);
      viewRels.classList.toggle('active', !isFacts);
    };
    tabFacts.addEventListener('click', () => {
      selectTab('facts');
      requestAnimationFrame(() => renderSidebar());
    });
    tabRels.addEventListener('click', () => {
      selectTab('rels');
      requestAnimationFrame(() => renderSidebar());
    });
    tabsInitialized = true;
  }

  function renderCharacterPanel(data, ch, startChunk, chunk, base, S, E) {
    clearNodeHighlights();
    for (const key of (dom?.edges ? dom.edges.keys() : [])) setEdgeHighlight(key, false);
    // Ensure the selected character is highlighted in the network
    setNodeHighlight(ch.id, true);
    sidebarHint.style.display = 'none';
    if (sidebarTitle) sidebarTitle.textContent = 'Character Details';
    if (browsePanel) browsePanel.style.display = 'none';
    if (interPanel) interPanel.style.display = 'none';
    if (charPanel) charPanel.style.display = 'block';
    if (charHeader) charHeader.textContent = ch.name;
    const upTo = base + Math.max(0, (state.chunk || 0) - 1);
    const summaryText = getCurrentSummary(ch, upTo) || '';
    if (charSummary) {
      charSummary.textContent = summaryText;
      charSummary.style.display = summaryText ? 'block' : 'none';
    }
    ensureTabs();
    if (!viewFacts.classList.contains('active') && !viewRels.classList.contains('active')) {
      tabFacts?.setAttribute('aria-selected', 'true');
      tabRels?.setAttribute('aria-selected', 'false');
      viewFacts.classList.add('active');
      viewRels.classList.remove('active');
    }

    if (charFactHistEl || charInterHistEl) {
      const { bins: charBins } = computeHistogramBinsFromFacts(factsInRangeChar(ch, startChunk, chunk), startChunk, chunk, 20);
      if (charFactHistEl) {
        renderHistogram(charFactHistEl, charBins, {
          color: '#3b82f6',
          xStartPct: (S / Math.max(1, state.N)) * 100,
          xEndPct: (E / Math.max(1, state.N)) * 100,
          xLabel: 'Book progress',
        });
      }
      const interFacts = collectInteractionFactsForChar(data.interactions || [], ch.id, startChunk, chunk);
      const { bins: interBins } = computeHistogramBinsFromFacts(interFacts, startChunk, chunk, 20);
      if (charInterHistEl) {
        renderHistogram(charInterHistEl, interBins, {
          color: '#6366f1',
          xStartPct: (S / Math.max(1, state.N)) * 100,
          xEndPct: (E / Math.max(1, state.N)) * 100,
          xLabel: 'Book progress',
        });
      }
    }

    const endInclusive = Math.max(startChunk, (chunk || 0) - 1);
    const facts = factsInRangeChar(ch, startChunk, chunk)
      .sort((a, b) => (a.chunk_id - b.chunk_id) || (a.fact_id - b.fact_id));
    if (charStatus) {
      charStatus.textContent = `Facts in chunks ${startChunk}–${endInclusive}: ${facts.length}`;
      charStatus.style.color = '#374151';
    }
    if (eventList) {
      eventList.innerHTML = '';
      for (const f of facts) {
        appendEventItem(eventList, {
          titleText: `[${f.fact_id}] ${f.text}`,
          metaText: ch.name,
          hoverText: `Argument: ${f.argument || ''} (chunk ${f.chunk_id ?? '?'})`,
          chunkId: f.chunk_id,
        });
      }
    }

    if (relList) {
      relList.innerHTML = '';
      const rels = [];
      for (const inter of (data.interactions || [])) {
        if (inter.a_id !== ch.id && inter.b_id !== ch.id) continue;
        const weight = factsInRangeInter(inter, startChunk, chunk).length;
        if (weight <= 0) continue;
        const rel = getCurrentRel(inter, (chunk || 0) - 1) || { score: 0, text: '' };
        const otherId = inter.a_id === ch.id ? inter.b_id : inter.a_id;
        const other = (data.characters || []).find((c) => c.id === otherId);
        rels.push({
          id: inter.id,
          a: inter.a_id,
          b: inter.b_id,
          name: other?.name || `#${otherId}`,
          weight,
          score: rel.score,
          summary: rel.text || '',
          a_name: (data.characters || []).find((c) => c.id === inter.a_id)?.name || `#${inter.a_id}`,
          b_name: (data.characters || []).find((c) => c.id === inter.b_id)?.name || `#${inter.b_id}`,
        });
      }
      rels.sort((a, b) => (b.weight - a.weight) || (b.score - a.score) || a.name.localeCompare(b.name));
      if (charRelStatus) {
        charRelStatus.textContent = `Relationships in chunks ${startChunk}–${endInclusive}: ${rels.length}`;
        charRelStatus.style.color = '#374151';
      }
      for (const r of rels) {
        const li = document.createElement('li');
        li.className = 'event-item';
        const title = document.createElement('div');
        const leftName = (r.a === ch.id) ? ch.name : (r.a_name || '');
        const rightName = (r.b === ch.id) ? ch.name : (r.b_name || '');
        const t1 = leftName || (data.characters || []).find((c) => c.id === r.a)?.name || `#${r.a}`;
        const t2 = rightName || (data.characters || []).find((c) => c.id === r.b)?.name || `#${r.b}`;
        title.textContent = `${t1} • ${t2}`;
        li.appendChild(title);
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = `weight ${r.weight} • sentiment ${Number(r.score).toFixed(2)}`;
        li.appendChild(meta);
        li.addEventListener('mousemove', (e) => {
          tooltip.textContent = r.summary || '';
          tooltip.style.opacity = '1';
          positionTooltip(tooltip, e.clientX, e.clientY);
          setNodeHighlight(r.a, true);
          setNodeHighlight(r.b, true);
          setEdgeHighlight(r.id, true);
          bringEdgeToFront(r.id);
        });
        li.addEventListener('mouseleave', () => {
          tooltip.style.opacity = '0';
          if (state.selectedEdgeId === r.id) return;
          setNodeHighlight(r.a === ch.id ? r.b : r.a, false);
          setEdgeHighlight(r.id, false);
        });
        li.addEventListener('click', (ev) => {
          ev.stopPropagation();
          navigateTo({ type: 'edge', id: r.id }, { push: true });
        });
        relList.appendChild(li);
      }
    }
  }

  function renderRelationshipPanel(data, inter, startChunk, chunk, base, S, E) {
    clearNodeHighlights();
    for (const key of (dom?.edges ? dom.edges.keys() : [])) setEdgeHighlight(key, key === inter.id);
    setNodeHighlight(inter.a_id, true);
    setNodeHighlight(inter.b_id, true);
    bringEdgeToFront(inter.id);
    sidebarHint.style.display = 'none';
    if (sidebarTitle) sidebarTitle.textContent = 'Relationship Details';
    if (browsePanel) browsePanel.style.display = 'none';
    if (charPanel) charPanel.style.display = 'none';
    if (interPanel) interPanel.style.display = 'block';
    const rel = getCurrentRel(inter, (chunk || 0) - 1);
    if (interSummary) {
      const relText = rel?.text || '';
      interSummary.textContent = relText;
      interSummary.style.display = relText ? 'block' : 'none';
    }

    if (interFactHistEl || interSentChartEl) {
      const factsForHist = factsInRangeInter(inter, startChunk, chunk);
      const { bins } = computeHistogramBinsFromFacts(factsForHist, startChunk, chunk, 20);
      if (interFactHistEl) {
        renderHistogram(interFactHistEl, bins, {
          color: '#f59e0b',
          xStartPct: (S / Math.max(1, state.N)) * 100,
          xEndPct: (E / Math.max(1, state.N)) * 100,
          xLabel: 'Book progress',
        });
      }

      const S0 = startChunk;
      const E0 = chunk;
      const denom = Math.max(1, (E0 - S0));
      const summaries = Array.isArray(inter?.summaries) ? inter.summaries.slice().sort((a, b) => a.chunk_id - b.chunk_id) : [];
      const inRange = [];
      for (const sm of summaries) {
        const c = Number(sm?.chunk_id);
        if (!Number.isFinite(c) || c < S0 || c >= E0) continue;
        const t = (c - S0) / denom;
        inRange.push({ t, s: Number(sm.score || 0) });
      }
      if (interSentChartEl) {
        if (inRange.length === 0) {
          renderSentimentLine(interSentChartEl, [], {
            color: '#10b981',
            xStartPct: (S / Math.max(1, state.N)) * 100,
            xEndPct: (E / Math.max(1, state.N)) * 100,
            xLabel: 'Book progress',
          });
        } else {
          const pts = [...inRange];
          const last = pts[pts.length - 1];
          if (last.t < 1) pts.push({ t: 1, s: last.s });
          renderSentimentLine(interSentChartEl, pts, {
            color: '#10b981',
            xStartPct: (S / Math.max(1, state.N)) * 100,
            xEndPct: (E / Math.max(1, state.N)) * 100,
            xLabel: 'Book progress',
          });
        }
      }
    }

    const facts = factsInRangeInter(inter, startChunk, chunk)
      .sort((a, b) => (a.chunk_id - b.chunk_id) || (a.fact_id - b.fact_id));
    if (interHeader) {
      interHeader.innerHTML = '';
      const upTo = base + Math.max(0, (state.chunk || 0) - 1);
      const makeName = (id, name) => {
        const el = document.createElement('span');
        el.textContent = name;
        el.style.cursor = 'pointer';
        el.style.fontWeight = '600';
        el.addEventListener('mouseenter', () => setNodeHighlight(id, true));
        el.addEventListener('mousemove', (ev) => {
          try {
            const ch = (data.characters || []).find((c) => c.id === id);
            const txt = ch ? (getCurrentSummary(ch, upTo) || '') : '';
            if (txt) {
              tooltip.textContent = txt;
              tooltip.style.opacity = '1';
              positionTooltip(tooltip, ev.clientX, ev.clientY);
            }
          } catch {}
        });
        el.addEventListener('mouseleave', () => {
          tooltip.style.opacity = '0';
          if (state.selectedId === id || state.selectedEdgeId === inter.id) return;
          setNodeHighlight(id, false);
        });
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          navigateTo({ type: 'node', id }, { push: true });
        });
        return el;
      };
      const aEl = makeName(inter.a_id, inter.a_name);
      const sep = document.createElement('span'); sep.textContent = ' • ';
      const bEl = makeName(inter.b_id, inter.b_name);
      interHeader.appendChild(aEl);
      interHeader.appendChild(sep);
      interHeader.appendChild(bEl);
    }

    if (interStatus) {
      interStatus.textContent = `Facts in chunks ${startChunk}–${Math.max(startChunk, (chunk || 0) - 1)}: ${facts.length} • Sentiment: ${rel.score.toFixed(2)}`;
      interStatus.style.color = '#374151';
    }

    if (interEventList) {
      interEventList.innerHTML = '';
      for (const f of facts) {
        appendEventItem(interEventList, {
          titleText: `[${f.fact_id}] ${f.text}`,
          metaText: `${inter.a_name} • ${inter.b_name}`,
          hoverText: `Evidence: ${f.evidence || ''} (chunk ${f.chunk_id ?? '?'})`,
          chunkId: f.chunk_id,
        });
      }
    }
  }

  function renderActiveCharactersList(data, startChunk, chunk, base, S, E) {
    if (charPanel) charPanel.style.display = 'none';
    if (interPanel) interPanel.style.display = 'none';
    sidebarHint.style.display = 'none';
    clearNodeHighlights();
    for (const key of (dom?.edges ? dom.edges.keys() : [])) setEdgeHighlight(key, false);
    if (sidebarTitle) sidebarTitle.textContent = 'Active Characters';
    if (browsePanel) browsePanel.style.display = 'block';
    if (browseList) browseList.innerHTML = '';

    const endInclusive = Math.max(startChunk, (chunk || 0) - 1);
    const items = [];
    for (const ch of (data.characters || [])) {
      const facts = factsInRangeChar(ch, startChunk, chunk);
      const count = facts.length;
      if (count > 0) items.push({ ch, count });
    }
    items.sort((a, b) => (b.count - a.count) || a.ch.name.localeCompare(b.ch.name));
    if (browseStatus) {
      browseStatus.textContent = `Active in chunks ${startChunk}–${endInclusive}: ${items.length} characters`;
    }
    const upTo = base + Math.max(0, (state.chunk || 0) - 1);
    for (const { ch, count } of items) {
      const li = document.createElement('li');
      li.className = 'event-item';
      li.style.cursor = 'pointer';
      const title = document.createElement('div');
      title.textContent = ch.name;
      li.appendChild(title);
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${count} fact${count === 1 ? '' : 's'}`;
      li.appendChild(meta);
      li.addEventListener('mousemove', (e) => {
        const text = getCurrentSummary(ch, upTo) || '';
        if (text) {
          tooltip.textContent = text;
          tooltip.style.opacity = '1';
          positionTooltip(tooltip, e.clientX, e.clientY);
        }
        setNodeHighlight(ch.id, true);
      });
      li.addEventListener('mouseleave', () => {
        tooltip.style.opacity = '0';
        if (state.selectedId === ch.id) return;
        if (state.selectedEdgeId) {
          try {
            const inter = (state.data?.interactions || []).find((it) => it.id === state.selectedEdgeId);
            if (inter && (inter.a_id === ch.id || inter.b_id === ch.id)) return;
          } catch {}
        }
        setNodeHighlight(ch.id, false);
      });
      li.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setNodeHighlight(ch.id, false);
        navigateTo({ type: 'node', id: ch.id }, { push: true });
      });
      browseList?.appendChild(li);
    }
  }

  function renderSidebar() {
    const data = state.data;
    if (!data) {
      if (charPanel) charPanel.style.display = 'none';
      if (interPanel) interPanel.style.display = 'none';
      if (sidebarHint) sidebarHint.style.display = 'none';
      if (sidebarTitle) sidebarTitle.textContent = 'Active Characters';
      if (browsePanel) browsePanel.style.display = 'block';
      if (browseList) browseList.innerHTML = '';
      if (browseStatus) browseStatus.textContent = 'Select a book to see active characters';
      return;
    }
    const base = state.base || 0;
    const S = state.startChunk;
    const E = state.chunk;
    const startChunk = base + S;
    const chunk = base + E;

    if (state.selectedId) {
      const id = state.selectedId;
      const ch = data.characters.find((c) => c.id === id);
      if (!ch) return;
      renderCharacterPanel(data, ch, startChunk, chunk, base, S, E);
      return;
    }

    if (state.selectedEdgeId) {
      const eId = state.selectedEdgeId;
      const inter = (data.interactions || []).find((it) => it.id === eId);
      if (!inter) return;
      renderRelationshipPanel(data, inter, startChunk, chunk, base, S, E);
      return;
    }

    renderActiveCharactersList(data, startChunk, chunk, base, S, E);
  }

  return { renderSidebar, clearNodeHighlights };
}
