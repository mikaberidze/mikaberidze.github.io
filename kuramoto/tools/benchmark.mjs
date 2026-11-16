// CPU microbenchmark, not a browser/GPU or Canvas paint benchmark.
// Run: node kuramoto/tools/benchmark.mjs
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { buildGraph, makeState, force, CpuEngine } from '../sim-core.js';

function medianMs(fn) {
  for(let i=0;i<5;i++) fn();
  const times=[];
  for(let i=0;i<15;i++) { const t=performance.now(); fn(); times.push(performance.now()-t); }
  return times.sort((a,b)=>a-b)[7];
}
// Legacy algorithm retained solely for comparison. For complete graphs, its
// implicit ordered rows select exactly the same neighbors as the old builder.
function legacy(graph,state,out) {
  const {n,density,offsets,neighbors}=graph;
  const factor=2/Math.max(1,density*n);
  for(let i=0;i<n;i++) {
    const count=density===1?n-1:offsets[i+1]-offsets[i];
    const stride=Math.max(1,Math.ceil(count/320));
    let sum=0,samples=0;
    for(let p=0;p<count;p+=stride) {
      const j=density===1?(p<i?p:p+1):neighbors[offsets[i]+p];
      sum+=Math.sin(state.phases[j]-state.phases[i]); samples++;
    }
    out[i]=state.freqs[i]+factor*sum*count/Math.max(1,samples);
  }
}
console.log(`${process.version}; ${os.cpus()[0].model}; ${process.platform}/${process.arch}`);
console.log('ms, median of 15 warmed calls; build is one cold call. Exact Heun uses two force evaluations.');
console.log('N\tD\tedges\tCSR build\tlegacy sampled force\tnew exact force\texact Heun step');
for(const [n,d] of [[1000,.05],[5000,.05],[5000,1],[10000,.01],[20000,1]]) {
  const start=performance.now(),graph=await buildGraph(n,d,196613);
  const build=performance.now()-start;
  const state=makeState(n,.5,1);
  state.phases=Float64Array.from({length:n},(_,i)=>(i*2.399963229728653)%(2*Math.PI));
  const out=new Float64Array(n),s=new Float64Array(n),c=new Float64Array(n);
  const old=n<=10000?medianMs(()=>legacy(graph,state,out)):NaN;
  const exact=medianMs(()=>force(graph,state.phases,state.freqs,2,out,s,c));
  const cpu=new CpuEngine(graph,state),step=medianMs(()=>cpu.step(2));
  console.log([n,d,graph.edges,build,old,exact,step].map((x,i)=>i<3?x:Number.isNaN(x)?'—':x.toFixed(3)).join('\t'));
}
