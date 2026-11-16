import { buildGraph, CpuEngine, sampleIndices, wrap, order } from '../sim-core.js';
import { GpuEngine } from '../sim-gpu.js';
const output = document.getElementById('results');
output.textContent = '';
const log = text => { const line=document.createElement('div'); line.textContent=text; output.append(line); };
const check = (ok, message) => { if (!ok) throw new Error(message); };
const fixture = n => ({ phases: Float64Array.from({ length:n },(_,i)=>Math.sin(i*1.7)*3),
  freqs: Float64Array.from({length:n},(_,i)=>Math.cos(i)*2+.5), normals:new Float64Array(n) });
const copy = state => Object.fromEntries(Object.entries(state).map(([k,v])=>[k,v.slice()]));
async function gpuChecks() {
  for(const [n,d] of [[1,0],[1,1],[127,0],[129,1],[513,.05],[513,.4],[5000,.05],[10000,.01],[4097,1],[20000,1]]) {
    const graph=await buildGraph(n,d,196613), initial=fixture(n), ids=sampleIndices(n);
    const cpu=new CpuEngine(graph,copy(initial));
    const gpu=await GpuEngine.create(graph,copy(initial),ids);
    try {
      const start=performance.now();
      const schedule=Array.from({length:16},(_,i)=>[1.7+i*.001,1.701+i*.001]);
      const result=await gpu.batch(schedule);
      const elapsed=performance.now()-start;
      for(const [k,next] of schedule) cpu.step(k,next);
      const reference=cpu.snapshot(ids);
      let max=0;
      for(let j=0;j<ids.length;j++) max=Math.max(max,Math.abs(wrap(result.phases[j]-reference.phases[j])));
      check(max<3e-5,`phase error ${max} at N=${n},D=${d}`);
      check(Math.abs(result.order.r-reference.order.r)<3e-6,`all-node r error N=${n}`);
      const all=await gpu.readPhases();
      for(let i=0;i<n;i++) check(Math.abs(wrap(all[i]-cpu.state.phases[i]))<3e-5,'full state mismatch, including undisplayed nodes');
      check(Math.abs(order(all).r-result.order.r)<3e-6,'snapshot reduction differs from full checkpoint');
      if(n===4097) {
        const longSchedule=Array.from({length:64},()=>[2,2]);
        const longer=await gpu.batch(longSchedule);
        for(let i=0;i<64;i++) cpu.step(2);
        const expected=cpu.snapshot(ids);
        check(longer.phases.every((x,i)=>Math.abs(wrap(x-expected.phases[i]))<3e-5),'64-step batch state');
        log('PASS maximum 64-step GPU batch agrees with CPU');
        const changed=Float64Array.from(initial.freqs,x=>x+1);
        gpu.setFreqs(changed); gpu.setPhases(initial.phases);
        const reset=await gpu.batch([]);
        check(Math.abs(reset.phases[20]-initial.phases[ids[20]])<1e-6,'GPU phase reset');
      }
      log(`PASS GPU vs CPU N=${n} D=${d}; max phase error=${max.toExponential(2)}; 16 steps + snapshot=${elapsed.toFixed(1)} ms`);
    } finally { gpu.destroy(); }
  }
}

async function workerChecks() {
  const worker=new Worker(new URL('../sim-worker.js',import.meta.url),{type:'module'});
  const pending=[];
  const messages=[];
  worker.onmessage=({data})=>{
    messages.push(data);
    for(let i=pending.length-1;i>=0;i--) if(pending[i].matches(data)) {
      clearTimeout(pending[i].timeout); pending[i].resolve(data); pending.splice(i,1);
    }
  };
  function wait(matches) { return new Promise((resolve,reject)=>{
    const entry={matches,resolve,timeout:setTimeout(()=>reject(new Error('Worker timed out')),20000)};
    pending.push(entry);
  }); }
  async function send(message,type) {
    const promise=wait(d=>d.epoch===message.epoch&&(d.type===type||d.type==='error'));
    worker.postMessage(message); const result=await promise;
    check(result.type!=='error',result.text); return result;
  }
  const config={n:4097,density:1,seed:196613,mean:.5,std:1,backend:'cpu',reset:true};
  try {
    let ready=await send({type:'configure',epoch:1,config},'ready');
    check(ready.backend==='CPU worker','forced CPU selection');
    const before=await send({type:'run',epoch:1,k:1,sweep:.02,steps:16,control:7},'frame');
    check(before.completed>0 && before.time>0 && before.k>1 && before.control===7,'run metadata');
    ready=await send({type:'configure',epoch:2,config:{...config,reset:false,mean:1.5}},'ready');
    check(ready.phases.every((x,i)=>x===before.phases[i]),'frequency change must preserve phases');
    check(ready.time===before.time,'frequency update keeps simulation clock');
    check(ready.freqs.length===2000,'compact snapshot frequency data');
    ready=await send({type:'configure',epoch:3,config:{...config,reset:false,n:5000,backend:'gpu'}},'ready');
    check(ready.phases.every((x,i)=>Number.isFinite(x)),'backend switch finite phases');
    const reset=await send({type:'configure',epoch:4,config:{...config,n:5000,reset:false,resetPhases:true,backend:'gpu'}},'ready');
    check(reset.time===0,'phase reset clock');
    worker.postMessage({type:'configure',epoch:5,config:{...config,n:10000,density:.05}});
    ready=await send({type:'configure',epoch:6,config:{...config,n:123,density:0}},'ready');
    check(ready.n===123 && !messages.some(d=>d.type==='ready'&&d.epoch===5),'superseded graph cancelled');
    log('PASS worker CPU fallback, frequency preservation, backend switch, phase reset, graph cancellation and generation metadata');
  } finally { worker.terminate(); }
}

async function fallbackCheck(lost = false) {
  const worker=new Worker(new URL(lost ? './lost-gpu-worker.js' : './no-gpu-worker.js',import.meta.url),{type:'module'});
  try {
    const result=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Missing-GPU fallback timed out')),10000);
      worker.onmessage=({data})=>{
        if(data.type==='testReady') worker.postMessage({type:'configure',epoch:1,
          config:{n:100,density:.05,seed:7,mean:.5,std:1,backend:'gpu',reset:true}});
        if(data.type==='ready') {
          if(lost) worker.postMessage({type:'run',epoch:1,k:1,sweep:0,steps:16,control:0});
          else { clearTimeout(timeout); resolve(data); }
        }
        if(data.type==='recovery') { clearTimeout(timeout); resolve(data); }
        if(data.type==='error') { clearTimeout(timeout); reject(new Error(data.text)); }
      };
    });
    check(result.backend==='CPU worker','CPU recovery backend');
    if(lost) check(result.time===0 && result.text.includes('Restarted phases'),'visible device loss restart');
    else check(result.reason.includes('unavailable'),'missing API fallback reason');
    log(lost ? 'PASS GPU device loss visibly restarts phases on the CPU' :
      'PASS missing WebGPU API falls back to CPU with an explicit reason');
  } finally { worker.terminate(); }
}

async function uiChecks() {
  const frame=document.createElement('iframe');
  frame.title='App integration checks'; frame.style='width:1200px;height:950px;border:0';
  frame.src='../index.html'; document.body.append(frame);
  try {
    await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject;});
    const doc=frame.contentDocument, win=frame.contentWindow;
    // Simulation and snapshot drawing must continue without an animation clock.
    win.requestAnimationFrame=()=>0;
    const el=id=>doc.getElementById(id);
    const diagnostics=doc.documentElement.dataset;
    async function until(checkState) {
      const start=performance.now();
      while(!checkState()) {
        if(performance.now()-start>15000) throw new Error(`UI timed out: ${el('engineStatus').textContent}`);
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    }
    function change(id,value,event='input') {
      el(id).value=value; el(id).dispatchEvent(new win.Event(event,{bubbles:true}));
    }
    await until(()=>diagnostics.ready==='true');
    check(el('simRate').value==='auto','readable automatic playback is the default');
    await until(()=>diagnostics.throughput !== undefined);
    check(Number(diagnostics.throughput)<=2.2,'small system speed cap');
    change('simRate','0','change');
    change('density','1');
    check(Number(el('size').max)===20000,'absolute size limit');
    // Wait for the configuration acknowledgment before setting the larger N.
    await until(()=>diagnostics.ready==='true');
    change('size','20000'); change('simRate','auto','change');
    await until(()=>diagnostics.n==='20000' && diagnostics.ready==='true');
    await until(()=>diagnostics.throughput !== undefined);
    check(diagnostics.drawnNodes==='1000','network sample count');
    check(diagnostics.drawnEdges==='4000' && diagnostics.phasePoints==='2000','edge and phase budgets');
    for(const id of ['springCanvas','circleCanvas','phaseCanvas']) {
      const canvas=el(id), pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      check(pixels.some((value,i)=>i%4===3 && value>0),`${id} painted`);
    }
    log(`PASS app completion-driven 20k simulation and painting with requestAnimationFrame disabled: ${diagnostics.throughput} simulated seconds / second`);
    change('simRate','0','change');
    await new Promise(resolve=>setTimeout(resolve,100));
    const circle=el('circleCanvas');
    circle.style.height=`${circle.getBoundingClientRect().height+37.3}px`;
    await until(()=>{
      const rect=circle.getBoundingClientRect(), transform=circle.getContext('2d').getTransform();
      return Math.abs(transform.a*rect.width/circle.width-transform.d*rect.height/circle.height)<1e-6;
    });
    circle.style.height='';
    log('PASS phase circle retains equal displayed x/y scales after CSS resizing while paused');
    change('backend','cpu','change');
    await until(()=>diagnostics.device==='CPU worker' && diagnostics.ready==='true');
    change('density','.5');
    check(Number(el('size').value)===20000,'density does not impose an arbitrary size cap');
    // Supersede the dense build and verify the app can recover immediately.
    change('density','0');
    await until(()=>diagnostics.ready==='true');
    el('resetPhases').click();
    await until(()=>diagnostics.ready==='true');
    log('PASS app pause, CPU switch, full size range, superseded build and reset controls');
  } finally { frame.remove(); }
}
try {
  if(navigator.gpu) await gpuChecks(); else log('SKIP GPU: unavailable');
  await workerChecks(); await fallbackCheck();
  if(navigator.gpu) await fallbackCheck(true);
  await uiChecks();
  log('ALL CHECKS PASSED'); document.title='PASS · Kuramoto checks';
} catch(error) {
  log(`FAIL: ${error.stack}`); document.title='FAIL · Kuramoto checks';
}
