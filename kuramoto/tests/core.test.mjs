import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, edgeValue, force, CpuEngine, makeState, order, sampleIndices, sizeLimit, wrap } from '../sim-core.js';

const fixture = n => ({ phases: Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 3),
  freqs: Float64Array.from({ length: n }, (_, i) => Math.cos(i)), normals: new Float64Array(n) });
function direct(n, d, seed, phases, freqs, k) {
  return Float64Array.from(phases, (theta, i) => {
    let sum = 0;
    for (let j = 0; j < n; j++) if (i !== j && d !== 0 && (d === 1 || edgeValue(Math.min(i,j), Math.max(i,j), seed) <= d)) {
      sum += Math.sin(phases[j] - theta);
    }
    return freqs[i] + k / Math.max(1, d * n) * sum;
  });
}
for (const [n,d] of [[1,0],[1,1],[17,0],[17,1],[127,.03],[513,.7]]) {
  test(`exact forces and reciprocal CSR: N=${n}, D=${d}`, async () => {
    const graph = await buildGraph(n,d,196613), state = fixture(n);
    const output = new Float64Array(n);
    force(graph,state.phases,state.freqs,2.3,output,new Float64Array(n),new Float64Array(n));
    const oracle = direct(n,d,196613,state.phases,state.freqs,2.3);
    for (let i=0;i<n;i++) assert(Math.abs(output[i]-oracle[i])<1e-12);
    const netCoupling = output.reduce((sum,v,i)=>sum+v-state.freqs[i],0);
    assert(Math.abs(netCoupling)<1e-10);
    if (d>0 && d<1) {
      assert.equal(graph.neighbors.length, graph.edges*2);
      for(let i=0;i<n;i++) {
        const row=graph.neighbors.subarray(graph.offsets[i],graph.offsets[i+1]);
        assert.equal(new Set(row).size,row.length);
        for (const j of row) {
          assert.notEqual(i,j);
          assert(graph.neighbors.subarray(graph.offsets[j],graph.offsets[j+1]).includes(i));
        }
      }
    } else assert.equal(graph.neighbors.length,0);
  });
}

test('Heun converges quadratically against analytic two-oscillator relaxation', async () => {
  const graph=await buildGraph(2,1,1);
  function error(h) {
    const state={phases:new Float64Array([-.5,.5]),freqs:new Float64Array(2)};
    const engine=new CpuEngine(graph,state);
    for(let i=0;i<Math.round(1/h);i++) engine.step(2,2,h);
    const exact=2*Math.atan(Math.tan(.5)*Math.exp(-2));
    return Math.abs(state.phases[1]-state.phases[0]-exact);
  }
  assert(error(.005)<error(.01)/3.9);
  assert(error(.01)<2e-5);
});

test('free drift, zero K, bounded phases, all-node order', async () => {
  for(const d of [0,.2,1]) {
    const graph=await buildGraph(73,d,7), state=fixture(73), before=state.phases.slice();
    const engine=new CpuEngine(graph,state);
    for(let i=0;i<100;i++) engine.step(0);
    for(let i=0;i<73;i++) assert(Math.abs(wrap(state.phases[i]-before[i]-state.freqs[i]))<1e-12);
    assert(state.phases.every(x=>x>=-Math.PI && x<Math.PI));
    const snapshot=engine.snapshot(new Uint32Array([0,7]));
    assert.deepEqual(snapshot.order,order(state.phases));
  }
});

test('configuration preserves phases and frequency identities', () => {
  const before=makeState(100,.5,1), after=makeState(130,-1,2,before);
  assert.deepEqual(after.phases.slice(0,100),before.phases);
  for(let i=0;i<100;i++) assert.equal(after.freqs[i],-1+2*before.normals[i]);
});

test('sample uniqueness, topology budgets and build cancellation', async () => {
  for(const n of [1,100,2001,100000]) {
    const ids=sampleIndices(n); assert.equal(new Set(ids).size,ids.length);
    assert(ids.length<=2000 && ids.every(i=>i>=0 && i<n));
  }
  assert.equal(sizeLimit(1),20000); assert.equal(sizeLimit(0),20000);
  assert.equal(sizeLimit(.5),20000);
  await assert.rejects(buildGraph(20001,1,1),/budget/);
  await assert.rejects(buildGraph(20001,0,1),/budget/);
  await assert.rejects(buildGraph(100000,.05,1),/budget/);
  await assert.rejects(buildGraph(100,.05,1,async()=>{throw new Error('cancelled');}),/cancelled/);
});
