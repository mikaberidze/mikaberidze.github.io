import test from 'node:test';
import assert from 'node:assert/strict';
import { withSizeBackoff } from '../sim-recovery.js';
import { buildGraph } from '../sim-core.js';

test('resource failures report then progressively lower N until successful', async () => {
  const calls=[], reports=[];
  const result=await withSizeBackoff({n:20000,density:.05}, async config=>{
    calls.push(config.n);
    if(config.n>13000) throw new RangeError('GPU allocation failed');
    return config;
  }, event=>{reports.push(event);calls.push('report');});
  assert.deepEqual(calls,[20000,'report',16000,'report',12800]);
  assert.equal(result.n,12800); assert.equal(result.density,.05);
  assert.deepEqual(reports.map(x=>[x.from,x.n]),[[20000,16000],[16000,12800]]);
});

test('device buffer limits trigger reduction before allocating CSR neighbors', async () => {
  let attempts=0;
  const result=await withSizeBackoff({n:100,density:.5}, async config=>{
    attempts++;
    return buildGraph(config.n,config.density,196613,async()=>{},1024);
  }, ()=>{});
  assert(attempts>1); assert(result.n<100); assert(result.neighbors.byteLength<=1024);
});

test('all densities allow requesting 20,000; no fixed adjacency budget remains', async () => {
  // Reject by the actual supplied device limit, not by density-based N limits.
  await assert.rejects(buildGraph(20000,.5,1,async()=>{},4),/GPU.*buffer limits/);
});

test('programming errors and superseded requests are not retried', async () => {
  let calls=0;
  await assert.rejects(withSizeBackoff({n:100},async()=>{calls++;throw new Error('Shader invalid');},()=>{}),/Shader invalid/);
  assert.equal(calls,1);
  let current=true;
  await assert.rejects(withSizeBackoff({n:100},async()=>{current=false;throw new RangeError('allocation');},()=>assert.fail('stale retry'),()=>current),/allocation/);
});

test('retries stop at one oscillator rather than looping forever', async () => {
  const sizes=[];
  await assert.rejects(withSizeBackoff({n:3},async config=>{sizes.push(config.n);throw new RangeError('allocation');},()=>{}),/allocation/);
  assert.deepEqual(sizes,[3,2,1]);
});

const { Worker } = await import('node:worker_threads');
async function workerAttempt(config, faults) {
  const worker=new Worker(new URL('./worker-resource-fixture.mjs',import.meta.url),{workerData:faults});
  try {
    return await new Promise((resolve,reject)=>{
      const reports=[];
      const timeout=setTimeout(()=>{reject(new Error('worker retry timed out'));},10000);
      worker.on('error',error=>{clearTimeout(timeout);reject(error);});
      worker.on('message',data=>{
        if(data.type==='booted') worker.postMessage({type:'configure',epoch:1,config});
        if(data.type==='reduced') reports.push(data);
        if(data.type==='ready') {clearTimeout(timeout);resolve({data,reports});}
        if(data.type==='error') {clearTimeout(timeout);reject(new Error(data.text));}
      });
    });
  } finally { await worker.terminate(); }
}

test('real worker retries GPU allocation failures and returns the actual smaller state', async () => {
  const {data,reports}=await workerAttempt({n:256,density:.05,seed:7,mean:.5,std:1,backend:'gpu',reset:true},{maxNodes:128});
  assert.equal(data.n,104); assert.equal(data.phases.length,104);
  assert.deepEqual(reports.map(r=>r.n),[204,163,130,104]);
  assert.equal(data.backend,'CPU worker');
});

test('real worker retries hardware CSR limits before allocating oversized graphs', async () => {
  const {data,reports}=await workerAttempt({n:100,density:.5,seed:7,mean:.5,std:1,backend:'gpu',reset:true},{capacity:1024});
  assert(data.n<100); assert(reports.length>0);
  assert.equal(data.phases.length,data.n);
});
