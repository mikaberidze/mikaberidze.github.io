import { STEP } from './sim-core.js';

const params = `struct Params { n:u32, mode:u32, norm:f32, dt:f32, k:f32, stage:u32, groups:u32, pad:u32 };
@group(0) @binding(0) var<uniform> p:Params;`;
const trigShader = `${params}
@group(0) @binding(1) var<storage,read> phase:array<f32>;
@group(0) @binding(2) var<storage,read_write> trig:array<vec2f>;
@group(0) @binding(3) var<storage,read_write> partial:array<vec2f>;
var<workgroup> sums:array<vec2f,128>;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u,
 @builtin(local_invocation_index) lane:u32, @builtin(workgroup_id) group:vec3u) {
 var v=vec2f(0.0); if(id.x<p.n) { v=vec2f(sin(phase[id.x]),cos(phase[id.x])); trig[id.x]=v; }
 sums[lane]=v; workgroupBarrier();
 for(var stride=64u;stride>0u;stride/=2u) {
   if(lane<stride) { sums[lane]+=sums[lane+stride]; } workgroupBarrier();
 }
 if(lane==0u) { partial[group.x]=sums[0]; }
}`;
const reduceShader = `${params}
@group(0) @binding(1) var<storage,read> partial:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> total:array<vec2f>;
var<workgroup> sums:array<vec2f,128>;
@compute @workgroup_size(128) fn main(@builtin(local_invocation_index) lane:u32) {
 var v=vec2f(0.0); for(var i=lane;i<p.groups;i+=128u) { v+=partial[i]; }
 sums[lane]=v; workgroupBarrier();
 for(var stride=64u;stride>0u;stride/=2u) {
  if(lane<stride) { sums[lane]+=sums[lane+stride]; } workgroupBarrier();
 } if(lane==0u) { total[0]=sums[0]; }
}`;
const forceBindings = `${params}
@group(0) @binding(1) var<storage,read> trig:array<vec2f>;
@group(0) @binding(2) var<storage,read> total:array<vec2f>;
@group(0) @binding(3) var<storage,read> freq:array<f32>;
@group(0) @binding(4) var<storage,read> offsets:array<u32>;
@group(0) @binding(5) var<storage,read> neighbors:array<u32>;
@group(0) @binding(6) var<storage,read_write> output:array<f32>;
fn velocity(i:u32,v:vec2f)->f32 { return freq[i]+p.k/p.norm*(trig[i].y*v.x-trig[i].x*v.y); }
`;
const forceShader = `${forceBindings}
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x; if(i>=p.n) { return; }
 var v=vec2f(0.0);
 if(p.mode==1u) { v=total[0]; }
 else if(p.mode==2u) { for(var j=offsets[i];j<offsets[i+1u];j++) { v+=trig[neighbors[j]]; } }
 output[i]=velocity(i,v);
}`;
const rowShader = `${forceBindings}
var<workgroup> sums:array<vec2f,128>;
@compute @workgroup_size(128) fn main(@builtin(workgroup_id) group:vec3u,
 @builtin(local_invocation_index) lane:u32) {
 let i=group.x; var v=vec2f(0.0);
 for(var j=offsets[i]+lane;j<offsets[i+1u];j+=128u) { v+=trig[neighbors[j]]; }
 sums[lane]=v; workgroupBarrier();
 for(var stride=64u;stride>0u;stride/=2u) {
  if(lane<stride) { sums[lane]+=sums[lane+stride]; } workgroupBarrier();
 } if(lane==0u) { output[i]=velocity(i,sums[0]); }
}`;
const updateShader = `${params}
@group(0) @binding(1) var<storage,read> base:array<f32>;
@group(0) @binding(2) var<storage,read> first:array<f32>;
@group(0) @binding(3) var<storage,read> second:array<f32>;
@group(0) @binding(4) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u) {
 let i=id.x; if(i>=p.n) { return; }
 var v=base[i]+p.dt*first[i];
 if(p.stage==1u) { v=base[i]+p.dt*0.5*(first[i]+second[i]); }
 output[i]=v-6.28318530718*floor((v+3.14159265359)/6.28318530718);
}`;
const sampleShader = `${params}
@group(0) @binding(1) var<storage,read> phase:array<f32>;
@group(0) @binding(2) var<storage,read> indices:array<u32>;
@group(0) @binding(3) var<storage,read> total:array<vec2f>;
@group(0) @binding(4) var<storage,read_write> output:array<f32>;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) id:vec3u) {
 let count=arrayLength(&indices);
 if(id.x<count) { output[id.x]=phase[indices[id.x]]; }
 if(id.x==0u) { output[count]=length(total[0])/f32(p.n); output[count+1u]=atan2(total[0].x,total[0].y); }
}`;

export class GpuEngine {
  static async graphCapacity() {
    try {
      const adapter = await globalThis.navigator?.gpu?.requestAdapter();
      return adapter ? Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize) : Infinity;
    } catch { return Infinity; }
  }
  static async create(graph, state, indices) {
    if (!globalThis.navigator?.gpu) throw new Error('WebGPU is unavailable in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter is available.');
    const bytes = Math.max(graph.neighbors.byteLength, graph.offsets.byteLength, graph.n * 8);
    if (bytes > adapter.limits.maxStorageBufferBindingSize || bytes > adapter.limits.maxBufferSize) {
      throw new Error('Graph exceeds this GPU’s buffer limits.');
    }
    const device = await adapter.requestDevice({ requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, Math.max(bytes, 128 * 1024 * 1024)),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, Math.max(bytes, 256 * 1024 * 1024)),
    } });
    const engine = new GpuEngine(device, graph, indices);
    device.pushErrorScope('out-of-memory');
    let failure;
    try { await engine.init(state); } catch (error) { failure = error; }
    const allocationError = await device.popErrorScope();
    if (allocationError) failure = new RangeError(`GPU allocation failed: ${allocationError.message}`);
    if (failure) { engine.destroy(); throw failure; }
    return engine;
  }
  constructor(device, graph, indices) {
    this.device = device; this.graph = graph; this.indices = indices;
    this.buffers = []; this.cache = new Map(); this.current = 0;
    this.lost = false; this.disposed = false;
    device.lost.then(info => { if (!this.disposed) this.lost = info.message || 'GPU device lost'; });
    device.addEventListener('uncapturederror', event => { this.lost = event.error.message; });
  }
  buffer(dataOrBytes, usage = GPUBufferUsage.STORAGE) {
    const size = Math.max(4, typeof dataOrBytes === 'number' ? dataOrBytes : dataOrBytes.byteLength);
    if (size > this.device.limits.maxBufferSize ||
      ((usage & GPUBufferUsage.STORAGE) && size > this.device.limits.maxStorageBufferBindingSize)) {
      throw new Error('Graph exceeds this GPU’s buffer limits.');
    }
    const buffer = this.device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.buffers.push(buffer);
    if (typeof dataOrBytes !== 'number' && dataOrBytes.byteLength) this.device.queue.writeBuffer(buffer, 0, dataOrBytes);
    return buffer;
  }
  async init(state) {
    const { n } = this.graph;
    this.groups = Math.ceil(n / 128);
    this.params = this.buffer(128 * 256, GPUBufferUsage.UNIFORM);
    this.phase = [this.buffer(Float32Array.from(state.phases)), this.buffer(n * 4), this.buffer(n * 4)];
    this.trig = this.buffer(n * 8); this.partial = this.buffer(this.groups * 8); this.total = this.buffer(8);
    this.freq = this.buffer(Float32Array.from(state.freqs));
    this.offsets = this.buffer(this.graph.offsets); this.neighbors = this.buffer(this.graph.neighbors);
    this.first = this.buffer(n * 4); this.second = this.buffer(n * 4);
    this.sampleIds = this.buffer(this.indices); this.sample = this.buffer((this.indices.length + 2) * 4);
    // One batch is in flight at a time. Mapping this compact snapshot never
    // transfers the full system and never blocks per integration substep.
    this.staging = this.device.createBuffer({ size: (this.indices.length + 2) * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.buffers.push(this.staging);
    this.pipelines = {};
    this.device.pushErrorScope('validation');
    try {
      for (const [name, code] of Object.entries({ trig: trigShader, reduce: reduceShader,
        force: forceShader, row: rowShader, update: updateShader, sample: sampleShader })) {
        // Sparse row shaders do not read totals, but retain the same bindings.
        const layout = name === 'row' || name === 'force' ? this.device.createPipelineLayout({
          bindGroupLayouts: [this.device.createBindGroupLayout({ entries: Array.from({ length: 7 }, (_, i) => ({
            binding: i, visibility: GPUShaderStage.COMPUTE,
            buffer: { type: i === 0 ? 'uniform' : i === 6 ? 'storage' : 'read-only-storage' },
          })) })],
        }) : 'auto';
        this.pipelines[name] = await this.device.createComputePipelineAsync({ layout,
          compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main' } });
      }
    } finally {
      const error = await this.device.popErrorScope();
      if (error) throw new Error(error.message);
    }
  }
  writeParams(schedule) {
    const data = new ArrayBuffer(Math.max(2, schedule.length * 2) * 256);
    const view = new DataView(data), { n, density } = this.graph;
    for (let slot = 0; slot < Math.max(2, schedule.length * 2); slot++) {
      const at = slot * 256, stage = slot % 2, pair = schedule[Math.floor(slot / 2)] || [0, 0];
      view.setUint32(at, n, true);
      view.setUint32(at + 4, density === 1 ? 1 : density === 0 ? 0 : 2, true);
      view.setFloat32(at + 8, Math.max(1, density * n), true);
      view.setFloat32(at + 12, STEP, true); view.setFloat32(at + 16, pair[stage], true);
      view.setUint32(at + 20, stage, true); view.setUint32(at + 24, this.groups, true);
    }
    this.device.queue.writeBuffer(this.params, 0, data);
  }
  dispatch(pass, name, slot, buffers, count) {
    const pipeline = this.pipelines[name];
    // Reuse bind groups across batches; buffer IDs are stable within an engine.
    const key = `${name}:${slot}:${buffers.map(b => this.buffers.indexOf(b)).join(',')}`;
    let bind = this.cache.get(key);
    if (!bind) {
      bind = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.params, offset: slot * 256, size: 32 } },
        ...buffers.map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
      ] });
      this.cache.set(key, bind);
    }
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(count);
  }
  trigPass(pass, phase, slot, reduce = true) {
    this.dispatch(pass, 'trig', slot, [phase, this.trig, this.partial], this.groups);
    if (reduce) this.dispatch(pass, 'reduce', slot, [this.partial, this.total], 1);
  }
  forcePass(pass, slot, output) {
    const parallelRows = this.graph.density > 0 && this.graph.density < 1 &&
      this.graph.neighbors.length / this.graph.n > 64;
    this.dispatch(pass, parallelRows ? 'row' : 'force', slot,
      [this.trig, this.total, this.freq, this.offsets, this.neighbors, output],
      parallelRows ? this.graph.n : this.groups);
  }
  async batch(schedule) {
    if (this.lost) throw new Error(String(this.lost));
    if (schedule.length > 64) throw new Error('GPU batch exceeds 64 steps.');
    this.writeParams(schedule);
    const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
    for (let i = 0; i < schedule.length; i++) {
      const slot = i * 2, base = this.phase[this.current], predictor = this.phase[1];
      const next = this.phase[2 - this.current];
      this.trigPass(pass, base, slot, this.graph.density === 1); this.forcePass(pass, slot, this.first);
      this.dispatch(pass, 'update', slot, [base, this.first, this.second, predictor], this.groups);
      this.trigPass(pass, predictor, slot + 1, this.graph.density === 1); this.forcePass(pass, slot + 1, this.second);
      this.dispatch(pass, 'update', slot + 1, [base, this.first, this.second, next], this.groups);
      this.current = 2 - this.current;
    }
    this.trigPass(pass, this.phase[this.current], 0);
    this.dispatch(pass, 'sample', 0, [this.phase[this.current], this.sampleIds, this.total, this.sample],
      Math.ceil(this.indices.length / 128));
    pass.end();
    encoder.copyBufferToBuffer(this.sample, 0, this.staging, 0, this.staging.size);
    this.device.queue.submit([encoder.finish()]);
    await this.staging.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(this.staging.getMappedRange()).slice(); this.staging.unmap();
    if (this.lost) throw new Error(String(this.lost));
    return { phases: values.slice(0, this.indices.length),
      order: { r: Math.min(1, values[this.indices.length]), psi: values[this.indices.length + 1] } };
  }
  setFreqs(freqs) { this.device.queue.writeBuffer(this.freq, 0, Float32Array.from(freqs)); }
  setPhases(phases) { this.device.queue.writeBuffer(this.phase[this.current], 0, Float32Array.from(phases)); }
  async readPhases() {
    if (this.lost) throw new Error(String(this.lost));
    const bytes = this.graph.n * 4;
    const staging = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.phase[this.current], 0, staging, 0, bytes);
      this.device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ);
      const result = Float64Array.from(new Float32Array(staging.getMappedRange())); staging.unmap(); return result;
    } finally { staging.destroy(); }
  }
  destroy() {
    this.disposed = true;
    for (const buffer of this.buffers) buffer.destroy();
    this.device.destroy(); this.cache.clear();
  }
}
