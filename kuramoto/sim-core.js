// Shared, exact CPU reference and topology generation. No browser dependencies.
export const STEP = 0.01;
export const MAX_NETWORK_SIZE = 20000;
export const SAMPLE_LIMIT = 2000;
export const TAU = 2 * Math.PI;
export const wrap = x => x - TAU * Math.floor((x + Math.PI) / TAU);

export function edgeValue(i, j, seed) {
  let h = seed ^ Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function sampleIndices(n, limit = SAMPLE_LIMIT) {
  const count = Math.min(n, limit);
  return Uint32Array.from({ length: count }, (_, i) => Math.floor(i * n / count));
}

export function sizeLimit() { return MAX_NETWORK_SIZE; }

export async function buildGraph(n, density, seed, yieldWork = async () => {}, maxNeighborBytes = Infinity) {
  if (n > sizeLimit(density)) throw new Error('Network exceeds the topology budget.');
  const offsets = new Uint32Array(n + 1);
  if (density === 0 || density === 1) return {
    n, density, offsets, neighbors: new Uint32Array(0),
    edges: density === 1 ? n * (n - 1) / 2 : 0,
  };
  // Two passes avoid boxed arrays and their large transient memory overhead.
  let entries = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (edgeValue(i, j, seed) <= density) { offsets[i + 1]++; offsets[j + 1]++; entries += 2; }
    }
    if (entries * 4 > maxNeighborBytes) throw new RangeError('Graph exceeds this GPU’s buffer limits.');
    if (i % 32 === 0) await yieldWork(i / n * 0.5);
  }
  for (let i = 1; i <= n; i++) offsets[i] += offsets[i - 1];
  const neighbors = new Uint32Array(offsets[n]);
  const cursor = offsets.slice(0, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (edgeValue(i, j, seed) <= density) {
        neighbors[cursor[i]++] = j; neighbors[cursor[j]++] = i;
      }
    }
    if (i % 32 === 0) await yieldWork(0.5 + i / n * 0.5);
  }
  return { n, density, offsets, neighbors, edges: neighbors.length / 2 };
}

export function makeState(n, mean, std, previous) {
  const phases = new Float64Array(n), normals = new Float64Array(n), freqs = new Float64Array(n);
  const keep = previous ? Math.min(n, previous.phases.length) : 0;
  for (let i = 0; i < n; i++) {
    phases[i] = i < keep ? previous.phases[i] : Math.random() * TAU - Math.PI;
    normals[i] = i < keep ? previous.normals[i] :
      Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(TAU * Math.random());
    freqs[i] = mean + std * normals[i];
  }
  return { phases, normals, freqs };
}

export function force(graph, phases, freqs, k, out, sine, cosine) {
  const { n, density, offsets, neighbors } = graph;
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) {
    sine[i] = Math.sin(phases[i]); cosine[i] = Math.cos(phases[i]);
    s += sine[i]; c += cosine[i];
  }
  const factor = k / Math.max(1, density * n);
  for (let i = 0; i < n; i++) {
    let si = 0, ci = 0;
    if (density === 1) { si = s; ci = c; }
    else if (density !== 0) {
      for (let p = offsets[i]; p < offsets[i + 1]; p++) {
        const j = neighbors[p]; si += sine[j]; ci += cosine[j];
      }
    }
    out[i] = freqs[i] + factor * (cosine[i] * si - sine[i] * ci);
  }
}

export function order(phases) {
  let s = 0, c = 0;
  for (const phase of phases) { s += Math.sin(phase); c += Math.cos(phase); }
  return { r: Math.hypot(s, c) / phases.length, psi: Math.atan2(s, c) };
}

export class CpuEngine {
  constructor(graph, state) {
    this.graph = graph; this.state = state;
    for (const key of ['sine', 'cosine', 'first', 'second', 'predictor']) this[key] = new Float64Array(graph.n);
  }
  step(k, nextK = k, dt = STEP) {
    const { phases, freqs } = this.state;
    force(this.graph, phases, freqs, k, this.first, this.sine, this.cosine);
    for (let i = 0; i < phases.length; i++) this.predictor[i] = phases[i] + dt * this.first[i];
    force(this.graph, this.predictor, freqs, nextK, this.second, this.sine, this.cosine);
    for (let i = 0; i < phases.length; i++) phases[i] = wrap(phases[i] + dt / 2 * (this.first[i] + this.second[i]));
  }
  snapshot(indices) {
    return { phases: Float32Array.from(indices, i => this.state.phases[i]), order: order(this.state.phases) };
  }
}
