import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuEngine } from '../sim-gpu.js';

async function fixture(run, {capacity=512*1024*1024, allocationError=null}={}) {
  const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const originalInit=GpuEngine.prototype.init;
  let requested, destroyed=false;
  const device={lost:new Promise(()=>{}), addEventListener(){}, pushErrorScope(){},
    popErrorScope:async()=>allocationError, destroy(){destroyed=true;}};
  const adapter={limits:{maxStorageBufferBindingSize:capacity,maxBufferSize:capacity},
    requestDevice:async options=>{requested=options.requiredLimits;return device;}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{requestAdapter:async()=>adapter}}});
  GpuEngine.prototype.init=async function(){};
  try { await run({requested:()=>requested,destroyed:()=>destroyed}); }
  finally {
    GpuEngine.prototype.init=originalInit;
    if(originalNavigator) Object.defineProperty(globalThis,'navigator',originalNavigator);
    else delete globalThis.navigator;
  }
}
const graph=bytes=>({n:100,neighbors:{byteLength:bytes},offsets:{byteLength:404}});

test('GPU device requests the real graph capacity above default limits',async()=>{
  await fixture(async ({requested})=>{
    const engine=await GpuEngine.create(graph(200*1024*1024),{},new Uint32Array([0]));
    assert.equal(requested().maxStorageBufferBindingSize,200*1024*1024);
    assert.equal(requested().maxBufferSize,256*1024*1024);
    engine.destroy();
  });
});
test('GPU rejects unsupported actual hardware capacity before device allocation',async()=>{
  await fixture(async ({requested})=>{
    await assert.rejects(GpuEngine.create(graph(200*1024*1024),{},new Uint32Array([0])),/buffer limits/);
    assert.equal(requested(),undefined);
  },{capacity:128*1024*1024});
});
test('GPU allocation error scopes become retryable failures and dispose the failed device',async()=>{
  await fixture(async ({destroyed})=>{
    await assert.rejects(GpuEngine.create(graph(1024),{},new Uint32Array([0])),/GPU allocation failed/);
    assert(destroyed());
  },{allocationError:{message:'out of memory'}});
});
