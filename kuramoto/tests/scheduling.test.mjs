import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual page completion handler and pump without a browser clock.
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
function harness() {
  const events = [];
  const env = {
    worker: { postMessage: message => events.push(message) },
    epoch: 1, configured: true, inFlight: true, control: 0, batchLimit: 16,
    pumpTimer: null, nextBatchAt: 0, STEP: .01, now: 0,
    clearTimeout() {}, setTimeout: (callback, delay) => { events.push({ type: 'timer', callback, delay }); return 1; },
    rateInput: { value: '-1' }, couplingInput: {}, rateStatus: {},
    playback: { speed: 0, step: .00064 },
    state: { n: 100, coupling: 1, lastLog: 0, history: [] },
    performance: {}, document: { hidden: true },
    lastStats: 0, measuredTime: 0,
    receiveSnapshot: data => events.push({ type: 'snapshot', time: data.time }),
    updateLabels() {}, render: () => events.push({ type: 'draw' }),
  };
  env.performance.now = () => env.now;
  new Function('env', `with (env) {
    ${between('function pump()', 'function render()')}
    ${between('worker.onmessage =', 'worker.onerror =')}
  }`)(env);
  const frame = { type: 'frame', epoch: 1, control: 0, time: .16, k: 1,
    completed: 16, elapsed: 8, backend: 'WebGPU', order: { r: .5 } };
  return { env, events, frame };
}

test('each completed snapshot immediately submits more work before drawing, with a frozen clock', () => {
  const { env, events, frame } = harness();
  env.worker.onmessage({ data: frame });
  env.worker.onmessage({ data: { ...frame, time: .32 } });
  assert.deepEqual(events.map(e => e.type), ['snapshot', 'run', 'draw', 'snapshot', 'run', 'draw']);
  assert.equal(events[1].steps, 16);
  assert.equal(events[4].steps, 16);
  assert.equal(env.inFlight, true);
});

test('explicit pause displays the completed state without scheduling more computation', () => {
  const { env, events, frame } = harness();
  env.rateInput.value = '0';
  env.worker.onmessage({ data: frame });
  assert.deepEqual(events.map(e => e.type), ['snapshot', 'draw']);
  assert.equal(env.inFlight, false);
});

test('superseded results cannot draw or submit another batch', () => {
  const { env, events, frame } = harness();
  env.worker.onmessage({ data: { ...frame, epoch: 0 } });
  assert.deepEqual(events, []);
});

test('automatic small-network playback caps both time advance and batch jumps', () => {
  const { env, events, frame } = harness();
  env.rateInput.value = 'auto';
  env.worker.onmessage({ data: frame });
  assert.equal(events[1].steps, 3);
  env.worker.onmessage({ data: frame });
  const timer = events.find(e => e.type === 'timer');
  assert.equal(timer.delay, 15); // .03 simulated seconds / 2x playback
  assert.equal(events.filter(e => e.type === 'run').length, 1);
  env.now = 15; timer.callback();
  assert.equal(events.filter(e => e.type === 'run').length, 2);
});

test('automatic large-network playback immediately resubmits without pacing', () => {
  const { env, events, frame } = harness();
  env.rateInput.value = 'auto'; env.state.n = 2000;
  env.worker.onmessage({ data: frame });
  env.worker.onmessage({ data: frame });
  assert.equal(events.filter(e => e.type === 'run').length, 2);
  assert(!events.some(e => e.type === 'timer'));
});

test('canvas sizing preserves equal displayed scales after fractional size changes', () => {
  let width = 301.7, height = 281.9;
  const canvas = { getBoundingClientRect: () => ({ width, height }),
    getContext: () => ({ setTransform: (...transform) => { canvas.transform = transform; } }) };
  const env = { springCanvas: canvas, circleCanvas: canvas, phaseCanvas: canvas,
    window: { devicePixelRatio: 1.25 }, dimensions: new Map(), resizeRequested: true, needsLayout: false };
  const resize = new Function('env', `with(env) {
    ${between('function resizeCanvases()', 'function computeLayout()')}
    return resizeCanvases;
  }`)(env);
  for (const nextHeight of [281.9, 317.3]) {
    height = nextHeight; resize();
    const [sx,,,sy] = canvas.transform;
    assert(Math.abs(sx * width / canvas.width - sy * height / canvas.height) < 1e-12);
    assert.equal(env.dimensions.get(canvas).height, nextHeight);
  }
});

test('resource reduction updates the size control and reports the failure while retrying', () => {
  const { env, events } = harness();
  Object.assign(env, { diagnostics: {}, sizeInput: {value:20000}, pendingConfig: {n:20000},
    notice:'', engineStatus:{}, updateEngineStatus(){} });
  env.worker.onmessage({data:{type:'reduced',epoch:1,from:20000,n:16000,reason:'GPU allocation failed'}});
  assert.equal(env.sizeInput.value,16000);
  assert.equal(env.pendingConfig.n,16000);
  assert.match(env.notice,/20,000.*16,000/);
  assert.equal(env.configured,false);
  assert.equal(env.engineStatus.title,'GPU allocation failed');
  assert.deepEqual(events,[]);
});
