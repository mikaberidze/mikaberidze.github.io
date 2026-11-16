import { STEP, buildGraph, makeState, CpuEngine, sampleIndices } from './sim-core.js';
import { GpuEngine } from './sim-gpu.js';
import { isResourceError, withSizeBackoff } from './sim-recovery.js';

let engine, graph, state, indices, backend = 'CPU worker', epoch = 0, wanted = 0;
let graphSeed, simTime = 0, queue = Promise.resolve();
let activeConfig;
const cancelled = () => new Error('Superseded');
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

function send(type, data = {}) { postMessage({ type, epoch, ...data }); }
async function snapshot() { return engine instanceof GpuEngine ? engine.batch([]) : engine.snapshot(indices); }

async function configure(message) {
  const { config } = message;
  epoch = message.epoch;
  const token = epoch;
  const threshold = config.density === 0 || config.density === 1 ? 8192 : 1024;
  const preferGpu = config.backend === 'gpu' || (config.backend === 'auto' && config.n >= threshold);
  const smallSystem = config.backend === 'auto' && !preferGpu;
  const sameGraph = graph && graph.n === config.n && graph.density === config.density && graphSeed === config.seed;
  const sameBackend = preferGpu ? engine instanceof GpuEngine && !engine.lost : engine instanceof CpuEngine;
  // Frequency sliders and phase resets do not rebuild the graph, recompile
  // pipelines, or download the full phase buffer.
  if (sameGraph && sameBackend && !config.reset) {
    for (let i = 0; i < graph.n; i++) state.freqs[i] = config.mean + config.std * state.normals[i];
    if (config.resetPhases) {
      for (let i = 0; i < graph.n; i++) state.phases[i] = Math.random() * 2 * Math.PI - Math.PI;
      simTime = 0;
    }
    if (engine instanceof GpuEngine) {
      engine.setFreqs(state.freqs);
      if (config.resetPhases) engine.setPhases(state.phases);
    }
    const result = await snapshot();
    if (token !== wanted) throw cancelled();
    send('ready', { n: config.n, density: config.density, backend, reason: '', smallSystem, edges: graph.edges,
      freqs: Float32Array.from(indices, i => state.freqs[i]), time: simTime, ...result });
    return;
  }
  // Structural/backend changes preserve all phases, including undisplayed nodes.
  // This full transfer occurs only on configuration changes, never per frame.
  let previous = state;
  if (engine instanceof GpuEngine) {
    try { state.phases = await engine.readPhases(); }
    catch { previous = undefined; send('notice', { text: 'GPU unavailable; restarting phases on the CPU.' }); }
    engine.destroy(); engine = null;
  }
  if (token !== wanted) throw cancelled();
  if (!graph || graph.n !== config.n || graph.density !== config.density || graphSeed !== config.seed) {
    const maxNeighborBytes = preferGpu ? await GpuEngine.graphCapacity() : Infinity;
    graph = await buildGraph(config.n, config.density, config.seed, async progress => {
      if (token !== wanted) throw cancelled();
      // Yield periodically so newer configurations can cancel the build.
      await yieldTask();
      if (token !== wanted) throw cancelled();
      if (Math.floor(progress * 100) % 10 === 0) send('progress', { progress });
    }, maxNeighborBytes);
    graphSeed = config.seed;
  }
  if (token !== wanted) throw cancelled();
  state = makeState(config.n, config.mean, config.std, config.reset ? undefined : previous);
  if (config.resetPhases) {
    for (let i = 0; i < state.phases.length; i++) state.phases[i] = Math.random() * 2 * Math.PI - Math.PI;
  }
  if (config.reset || config.resetPhases || !previous) simTime = 0;
  indices = sampleIndices(config.n);
  let reason = '';
  if (preferGpu) {
    try { engine = await GpuEngine.create(graph, state, indices); backend = 'WebGPU'; }
    catch (error) { engine = null; if (isResourceError(error)) throw error; reason = error.message; }
  }
  if (!(engine instanceof GpuEngine) || !preferGpu) { engine = new CpuEngine(graph, state); backend = 'CPU worker'; }
  if (token !== wanted) { if (engine instanceof GpuEngine) engine.destroy(); engine = null; throw cancelled(); }
  let result;
  try { result = await snapshot(); }
  catch (error) {
    if (!(engine instanceof GpuEngine)) throw error;
    engine.destroy(); engine = null;
    if (isResourceError(error)) throw error;
    engine = new CpuEngine(graph, state); backend = 'CPU worker'; reason = error.message;
    result = await snapshot();
  }
  if (token !== wanted) throw cancelled();
  send('ready', { n: config.n, density: config.density, backend, reason, smallSystem, edges: graph.edges,
    freqs: Float32Array.from(indices, i => state.freqs[i]), time: simTime, ...result });
}

async function configureWithRecovery(message) {
  await withSizeBackoff(message.config, async config => {
    await configure({ ...message, config });
    if (message.epoch === wanted) activeConfig = { ...config, reset: false, resetPhases: false };
  }, failure => {
    // Release failed resources before allocating the smaller topology.
    if (engine instanceof GpuEngine) engine.destroy();
    engine = null; graph = null;
    send('reduced', failure);
  }, () => message.epoch === wanted);
}

async function run(message) {
  if (message.epoch !== epoch || epoch !== wanted || !engine) return;
  const started = performance.now();
  let k = message.k, completed = 0;
  const schedule = [];
  const nextK = value => Math.max(0, Math.min(3, value + message.sweep * STEP));
  const requested = Math.min(64, Math.max(1, message.steps));
  let result;
  try {
    if (engine instanceof GpuEngine) {
      for (let i = 0; i < requested; i++) { const next = nextK(k); schedule.push([k, next]); k = next; }
      result = await engine.batch(schedule); completed = schedule.length;
    } else {
      do {
        const next = nextK(k); engine.step(k, next); k = next; completed++;
      } while (completed < requested && performance.now() - started < 10);
      result = engine.snapshot(indices);
    }
    simTime += completed * STEP;
    send('frame', { ...result, k, time: simTime, completed, elapsed: performance.now() - started,
      control: message.control, backend });
  } catch (error) {
    if (!(engine instanceof GpuEngine)) throw error;
    if (isResourceError(error) && graph.n > 1) {
      const n = Math.max(1, Math.floor(graph.n * .8));
      send('reduced', { from: graph.n, n, reason: error.message });
      engine.destroy(); engine = null; graph = null;
      // The lost device cannot checkpoint its latest full state.
      await configureWithRecovery({ epoch, config: { ...activeConfig, n, resetPhases: true } });
      return;
    }
    engine.destroy();
    // A lost device cannot supply a current full checkpoint. Restart visibly.
    for (let i = 0; i < state.phases.length; i++) state.phases[i] = Math.random() * 2 * Math.PI - Math.PI;
    engine = new CpuEngine(graph, state); backend = 'CPU worker'; simTime = 0;
    send('recovery', { text: `GPU stopped (${error.message}). Restarted phases on CPU.`,
      backend, time: simTime, ...(await snapshot()) });
  }
}

onmessage = event => {
  const message = event.data;
  if (message.type === 'configure') wanted = message.epoch;
  queue = queue.then(() => message.type === 'configure' ? configureWithRecovery(message) : run(message))
    .catch(error => {
      if (error.message !== 'Superseded') send('error', { text: error.message });
    });
};
