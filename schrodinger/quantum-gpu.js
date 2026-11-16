// GPU state owns the evolving wavefunction between explicit CPU synchronizations.
// The visible Canvas2D is retained for screenshots, recording, PiP and CPU fallback.
class QuantumGPU {
  constructor() {
    this.surface = document.createElement('canvas');
    const gl = this.gl = this.surface.getContext('webgl2', {
      alpha: true, premultipliedAlpha: false, antialias: false,
      preserveDrawingBuffer: true, depth: false, stencil: false,
    });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('WebGL2 floating-point render targets unavailable');
    }
    this.targets = [];
    this.cpuCurrent = true;
    this.uploadNeeded = true;
    this.potentialDirty = true;
    this.basisCache = new Map();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.programs = {};
    for (const [name, fragment] of Object.entries(QuantumGPU.fragments)) {
      this.programs[name] = this.program(fragment);
    }
    this.surface.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.lost = true;
      // A lost context cannot be read. Fall back to the most recent checkpoint.
      this.restoreCheckpoint();
      quantumGPUDisabled = true;
      reportQuantumFallback('GPU reset; resumed on CPU from the latest checkpoint.');
      if (typeof drawScene === 'function') drawScene();
    });
  }

  program(fragment) {
    const gl = this.gl;
    const compile = (kind, source) => {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0, 1);
      }`);
    const pixel = compile(gl.FRAGMENT_SHADER, QuantumGPU.header + fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, pixel);
    gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(pixel);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(message);
    }
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = {location: gl.getUniformLocation(program, info.name), type: info.type};
    }
    return {program, uniforms};
  }

  target(w, h, single = false) {
    const gl = this.gl;
    const texture = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, single ? gl.R32F : gl.RGBA32F, w, h, 0,
      single ? gl.RED : gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const target = {texture, fbo, w, h};
    this.targets.push(target);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('GPU framebuffer allocation failed');
    }
    return target;
  }

  releaseTargets() {
    for (const t of this.targets) {
      this.gl.deleteTexture(t.texture); this.gl.deleteFramebuffer(t.fbo);
    }
    this.targets = []; this.basisCache.clear(); this.previous = null;
  }

  ensure() {
    if (this.lost || this.gl.isContextLost()) throw new Error('GPU context lost');
    const gl = this.gl;
    if (this.w !== simWidth || this.h !== simHeight) {
      this.releaseTargets();
      this.w = simWidth; this.h = simHeight;
      if (!this.w || !this.h || Math.max(this.w, this.h) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
        throw new Error('Unsupported GPU grid dimensions');
      }
      this.surface.width = this.w; this.surface.height = this.h;
      this.read = this.target(this.w, this.h);
      this.write = this.target(this.w, this.h);
      this.rhs = this.target(this.w, this.h);
      this.potential = null;
      this.reductions = [];
      let w = this.w, h = this.h;
      do {
        w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2));
        this.reductions.push(this.target(w, h));
      } while (w > 1 || h > 1);
      this.transfer = new Float32Array(this.w * this.h * 4);
      this.uploadNeeded = true; this.potentialDirty = true;
    }
    if (this.uploadNeeded) {
      this.upload(this.read, psiRe, psiIm);
      this.uploadNeeded = false; this.cpuCurrent = true;
      this.saveCheckpoint();
    }
    if (!this.potential || this.potential.w !== Math.max(1, potentialWidth) ||
        this.potential.h !== Math.max(1, potentialHeight)) {
      if (this.potential) {
        gl.deleteTexture(this.potential.texture); gl.deleteFramebuffer(this.potential.fbo);
        this.targets.splice(this.targets.indexOf(this.potential), 1);
      }
      this.potential = this.target(Math.max(1, potentialWidth), Math.max(1, potentialHeight), true);
      this.potentialDirty = true;
    }
    if (this.potentialDirty || this.potentialSource !== potentialField) {
      gl.bindTexture(gl.TEXTURE_2D, this.potential.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.potential.w, this.potential.h,
        gl.RED, gl.FLOAT, potentialField || new Float32Array(1));
      this.potentialSource = potentialField; this.potentialDirty = false;
    }
  }

  upload(target, re, im) {
    const data = this.transfer;
    for (let i = 0; i < re.length; i++) {data[4*i] = re[i]; data[4*i+1] = im[i];}
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, data);
  }

  pass(name, output, textures = {}, values = {}) {
    const gl = this.gl, p = this.programs[name];
    gl.bindVertexArray(this.vao); gl.useProgram(p.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, output ? output.fbo : null);
    gl.viewport(0, 0, output ? output.w : this.w, output ? output.h : this.h);
    let unit = 0;
    for (const [key, u] of Object.entries(p.uniforms)) {
      if (u.type !== gl.SAMPLER_2D) continue;
      // Bind even branch-inactive samplers: WebGL validates feedback for all of them.
      const target = textures[key] || textures.state || Object.values(textures)[0];
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.uniform1i(u.location, unit++);
    }
    for (const [key, value] of Object.entries(values)) {
      const u = p.uniforms[key];
      if (!u) continue;
      if (u.type === gl.INT || u.type === gl.BOOL) gl.uniform1i(u.location, value);
      else gl.uniform1f(u.location, value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  swap() {[this.read, this.write] = [this.write, this.read]; this.cpuCurrent = false;}

  step() {
    this.ensure();
    const values = {dt:currentTimeStep, imaginary:isImaginaryTime ? 1 : 0,
      potentialScale:POTENTIAL_SCALE, layers: boundaryMode === 'open' ? ABSORB_LAYERS : 0,
      absorbMax:ABSORB_MAX, damping:0, mode:0};
    const textures = () => ({state:this.read, potential:this.potential, rhs:this.rhs});
    if (integratorScheme === 'euler') {
      this.pass('step', this.write, textures(), {...values, mode:2, damping:1}); this.swap();
    } else {
      this.pass('step', this.rhs, {state:this.read, potential:this.potential}, values);
      for (let i=0; i<CN_ITERS; i++) {
        this.pass('step', this.write, textures(), {...values, mode:1, damping:i===CN_ITERS-1?1:0});
        this.swap();
      }
    }
    simTime += currentTimeStep;
    this.rescale(psiRescaleMode);
    // Bound context-loss recovery cost without downloading the field each frame.
    if (performance.now() - this.checkpointAt > 1000) this.sync();
  }

  reduce(kind, extra = {}) {
    this.ensure();
    const first = this.reductions[0];
    this.pass('measure', first, {state:this.read, potential:this.potential, ...extra},
      {kind, potentialScale:POTENTIAL_SCALE});
    let source = first;
    for (let i=1; i<this.reductions.length; i++) {
      this.pass('reduce', this.reductions[i], {source}, {maximum:kind===1 || kind===4 ? 1:0});
      source = this.reductions[i];
    }
    return source;
  }

  scalar(target) {
    if (this.gl.isContextLost()) throw new Error('GPU context lost');
    const data = new Float32Array(4), gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, data);
    return data;
  }

  rescale(mode) {
    if (mode !== 'norm' && mode !== 'max') return;
    const statistic = this.reduce(mode==='max'?1:0);
    const scalePos = BASE_SCALE_POS * this.w / BASE_RESOLUTION;
    this.pass('scale', this.write, {state:this.read, statistic},
      {weight:mode==='norm'?1/(scalePos*scalePos):1});
    this.swap();
    if (mode === 'norm') currentNormFactor = 1;
  }

  energy() {
    const scalePos = BASE_SCALE_POS * simWidth / BASE_RESOLUTION;
    return this.scalar(this.reduce(2))[0] / (scalePos*scalePos);
  }

  plotScale() {
    const max = this.scalar(this.reduce(1))[0];
    return max > 0 && Number.isFinite(max) ? 1 / Math.sqrt(max) : 1;
  }

  capturePrevious() {
    this.ensure();
    if (!this.previous) this.previous = this.target(this.w, this.h);
    this.pass('copy', this.previous, {state:this.read});
  }

  delta() {return Math.sqrt(this.scalar(this.reduce(4, {other:this.previous}))[0]);}

  orthogonalize() {
    this.ensure();
    const scalePos = BASE_SCALE_POS * this.w / BASE_RESOLUTION;
    // Discard cached textures when the potential invalidates the eigenstate list.
    for (const [basis, target] of this.basisCache) {
      if (!eigenstates.includes(basis)) {
        this.gl.deleteTexture(target.texture); this.gl.deleteFramebuffer(target.fbo);
        this.targets.splice(this.targets.indexOf(target), 1); this.basisCache.delete(basis);
      }
    }
    for (const basis of eigenstates) {
      let other = this.basisCache.get(basis);
      if (!other) {
        other = this.target(this.w, this.h); this.upload(other, basis.re, basis.im);
        this.basisCache.set(basis, other);
      }
      const statistic = this.reduce(3, {other});
      this.pass('project', this.write, {state:this.read, other, statistic}, {weight:1/(scalePos*scalePos)});
      this.swap();
    }
  }

  draw(context) {
    this.ensure();
    const ids = ['phase','qualitativeSoft','qualitativeBold','gold','heat','probGray','probGrayHot','viridis','blueRed'];
    this.pass('display', null, {state:this.read},
      {plotScale:plotScaleFactor, scheme:Math.max(0, ids.indexOf(activeColorSchemeId))});
    context.drawImage(this.surface, 0, 0);
  }

  finishFrame() {
    // A scalar readback fences submitted work without downloading the field.
    // Keep at most one completed update in flight instead of filling the GPU queue.
    this.scalar(this.read);
  }

  sync() {
    if (this.lost || this.uploadNeeded || this.cpuCurrent || !this.read) return;
    const gl = this.gl;
    if (gl.isContextLost()) throw new Error('GPU context lost');
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.read.fbo);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, this.transfer);
    for (let i=0; i<psiRe.length; i++) {psiRe[i]=this.transfer[4*i]; psiIm[i]=this.transfer[4*i+1];}
    this.cpuCurrent = true;
    this.saveCheckpoint();
  }

  saveCheckpoint() {
    // CPU arrays themselves hold the latest checkpoint; metadata must match them.
    this.checkpointAt = performance.now(); this.checkpointTime = simTime; this.checkpointFrame = frameCount;
  }

  restoreCheckpoint() {
    if (!this.cpuCurrent && !this.uploadNeeded) {
      simTime = this.checkpointTime; frameCount = this.checkpointFrame;
    }
    this.cpuCurrent = true;
  }

  dispose() {
    this.releaseTargets();
    for (const p of Object.values(this.programs)) this.gl.deleteProgram(p.program);
    this.gl.deleteVertexArray(this.vao);
  }
}

QuantumGPU.header = `#version 300 es
precision highp float;
precision highp int;
out vec4 result;
uniform sampler2D state;
vec2 psi(ivec2 p) {return texelFetch(state, clamp(p, ivec2(0), textureSize(state,0)-1),0).rg;}
`;
QuantumGPU.fragments = {
  step: `
    uniform sampler2D potential, rhs;
    uniform float dt, potentialScale, layers, absorbMax;
    uniform int mode, imaginary, damping;
    void main() {
      ivec2 p=ivec2(gl_FragCoord.xy), size=textureSize(state,0);
      vec2 z=psi(p);
      vec2 lap=(4.0*(psi(p+ivec2(-1,0))+psi(p+ivec2(1,0))+psi(p+ivec2(0,-1))+psi(p+ivec2(0,1)))
        +psi(p+ivec2(-1,-1))+psi(p+ivec2(1,-1))+psi(p+ivec2(-1,1))+psi(p+ivec2(1,1))-20.0*z)/6.0;
      ivec2 pp=clamp(ivec2(floor(vec2(p)*vec2(textureSize(potential,0))/vec2(size)+0.5)),ivec2(0),textureSize(potential,0)-1);
      float v=texelFetch(potential,pp,0).r*potentialScale;
      vec2 h=0.5*lap-v*z;
      vec2 dz=imaginary==1?h:vec2(-h.y,h.x);
      vec2 next=mode==1?texelFetch(rhs,p,0).rg+0.5*dt*dz:z+(mode==2?dt:0.5*dt)*dz;
      if(damping==1 && layers>0.0) {
        float dist=float(min(min(p.x,size.x-1-p.x),min(p.y,size.y-1-p.y)));
        if(dist<layers) {float s=(layers-dist)/layers; next*=exp(-absorbMax*s*s*dt);}
      }
      result=vec4(next,0,0);
    }`,
  measure: `
    uniform sampler2D potential, other;
    uniform int kind;
    uniform float potentialScale;
    void main() {
      ivec2 base=ivec2(gl_FragCoord.xy)*2, size=textureSize(state,0);
      vec2 total=vec2(0);
      for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
        ivec2 p=base+ivec2(x,y); if(any(greaterThanEqual(p,size))) continue;
        vec2 z=psi(p); vec2 value=vec2(dot(z,z),0);
        if(kind==2) {
          vec2 dx=psi(p+ivec2(1,0))-z, dy=psi(p+ivec2(0,1))-z;
          ivec2 pp=clamp(ivec2(floor(vec2(p)*vec2(textureSize(potential,0))/vec2(size)+0.5)),ivec2(0),textureSize(potential,0)-1);
          value.x=0.5*(dot(dx,dx)+dot(dy,dy))+texelFetch(potential,pp,0).r*potentialScale*dot(z,z);
        } else if(kind==3) {
          vec2 b=texelFetch(other,p,0).rg; value=vec2(dot(b,z),b.x*z.y-b.y*z.x);
        } else if(kind==4) {vec2 d=z-texelFetch(other,p,0).rg; value.x=dot(d,d);}
        if(kind==1 || kind==4) total=max(total,value); else total+=value;
      }
      result=vec4(total,0,0);
    }`,
  reduce: `
    uniform sampler2D source;
    uniform int maximum;
    void main() {
      ivec2 base=ivec2(gl_FragCoord.xy)*2, size=textureSize(source,0);
      vec2 total=vec2(0);
      for(int y=0;y<2;y++) for(int x=0;x<2;x++) {
        ivec2 p=base+ivec2(x,y); if(any(greaterThanEqual(p,size))) continue;
        vec2 v=texelFetch(source,p,0).rg;
        if(maximum==1) total=max(total,v); else total+=v;
      }
      result=vec4(total,0,0);
    }`,
  scale: `
    uniform sampler2D statistic; uniform float weight;
    void main() {
      float norm=texelFetch(statistic,ivec2(0),0).r*weight;
      float factor=norm>0.0 && !isinf(norm) && !isnan(norm)?inversesqrt(norm):1.0;
      result=vec4(psi(ivec2(gl_FragCoord.xy))*factor,0,0);
    }`,
  project: `
    uniform sampler2D statistic, other; uniform float weight;
    void main() {
      ivec2 p=ivec2(gl_FragCoord.xy);
      vec2 a=texelFetch(statistic,ivec2(0),0).rg*weight, b=texelFetch(other,p,0).rg;
      result=vec4(psi(p)-vec2(b.x*a.x-b.y*a.y,b.x*a.y+b.y*a.x),0,0);
    }`,
  copy: `void main() {result=vec4(psi(ivec2(gl_FragCoord.xy)),0,0);}`,
  display: `
    uniform float plotScale; uniform int scheme;
    const float PI=3.141592653589793;
    vec3 stops(float t, vec3 a,vec3 b,vec3 c,vec3 d,vec3 e) {
      float s=t*4.0;
      if(s<1.0)return mix(a,b,s); if(s<2.0)return mix(b,c,s-1.0);
      if(s<3.0)return mix(c,d,s-2.0);return mix(d,e,s-3.0);
    }
    void main() {
      // Texture row zero follows CPU array row zero. Flip only for screen output.
      ivec2 p=ivec2(gl_FragCoord.xy); p.y=textureSize(state,0).y-1-p.y;
      vec2 z=psi(p)*plotScale; float a=dot(z,z);
      if(a<=0.0 || isnan(a) || isinf(a)){result=vec4(0);return;}
      float t=clamp(sqrt(a),0.0,1.0), u=fract((atan(z.y,z.x)+PI)/(2.0*PI));
      vec3 c;
      if(scheme==0) {
        float h=(atan(z.y,z.x)+PI)/(2.0*PI)*6.0;
        int i=int(floor(h))%6; float f=fract(h), q=1.0-f;
        if(i==0)c=vec3(1,f,0);else if(i==1)c=vec3(q,1,0);else if(i==2)c=vec3(0,1,f);
        else if(i==3)c=vec3(0,q,1);else if(i==4)c=vec3(f,0,1);else c=vec3(1,0,q);
        c*=255.0;
      } else if(scheme==1) {
        int i=int(floor(fract(u+1.0/12.0)*3.0));
        c=i==0?vec3(249,168,212):i==1?vec3(110,231,183):vec3(147,197,253);
      } else if(scheme==2) {
        int i=int(floor(fract(u+1.0/12.0)*6.0));
        c=i==0?vec3(239,68,68):i==1?vec3(249,115,22):i==2?vec3(234,179,8):i==3?vec3(34,197,94):i==4?vec3(59,130,246):vec3(139,92,246);
      } else if(scheme==3) c=stops(t,vec3(5,7,12),vec3(92,59,0),vec3(207,166,58),vec3(255,226,138),vec3(255,246,207));
      else if(scheme==4)c=stops(t,vec3(5,7,12),vec3(127,29,29),vec3(249,115,22),vec3(250,204,21),vec3(254,252,232));
      else if(scheme==5)c=vec3(t*255.0);
      else if(scheme==6){c=vec3(t*255.0);if(t>0.9)c=mix(c,vec3(185,28,28),clamp((t-0.9)/0.02,0.0,1.0));}
      else if(scheme==7)c=stops(t,vec3(2,6,23),vec3(15,23,42),vec3(37,99,235),vec3(56,189,248),vec3(224,242,254));
      else {if(u<1.0/3.0)c=mix(vec3(220,38,38),vec3(34,197,94),u*3.0);
        else if(u<2.0/3.0)c=mix(vec3(34,197,94),vec3(37,99,235),(u-1.0/3.0)*3.0);
        else c=mix(vec3(37,99,235),vec3(220,38,38),(u-2.0/3.0)*3.0);}
      result=vec4(floor(c+0.5)/255.0,floor(clamp(a,0.0,1.0)*255.0+0.5)/255.0);
    }`,
};

let potentialRevision = 0;
let quantumGPU = null;
let quantumGPUDisabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('compute') === 'cpu';
function getQuantumGPU() {
  if (quantumGPUDisabled || typeof document === 'undefined') return null;
  if (!quantumGPU) {
    try {quantumGPU = new QuantumGPU();}
    catch (error) {quantumGPUDisabled = true; console.warn('[Schrödinger] CPU fallback:', error.message);}
  }
  return quantumGPUDisabled ? null : quantumGPU;
}
function syncWavefunctionToCPU() {
  if (!quantumGPU || quantumGPUDisabled) return;
  try { quantumGPU.sync(); }
  catch (error) {
    quantumGPU.restoreCheckpoint();
    quantumGPUDisabled = true;
    reportQuantumFallback('GPU reset; resumed on CPU from the latest checkpoint.');
    console.warn('[Schrödinger] CPU synchronization fallback:', error.message);
    quantumGPU.dispose();
  }
}
function markWavefunctionCPUChanged() {
  if (quantumGPU) {quantumGPU.uploadNeeded = true; quantumGPU.cpuCurrent = true;}
}
function markPotentialGPUChanged() {
  potentialRevision += 1;
  if (quantumGPU) quantumGPU.potentialDirty = true;
}
function runQuantumGPU(operation) {
  const gpu = getQuantumGPU();
  if (!gpu) return false;
  try {operation(gpu); return true;}
  catch (error) {
    // Preserve the last completed field before using CPU routines.
    try {gpu.sync();} catch {gpu.restoreCheckpoint();}
    quantumGPUDisabled = true;
    reportQuantumFallback('GPU unavailable; simulation is continuing on CPU.');
    console.warn('[Schrödinger] CPU fallback:', error.message);
    gpu.dispose();
    return false;
  }
}

function reportQuantumFallback(message) {
  console.warn('[Schrödinger]', message);
  if (typeof canvas === 'undefined' || !canvas || !canvas.parentElement) return;
  let status = document.getElementById('quantum-compute-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'quantum-compute-status';
    status.setAttribute('role', 'status');
    status.style.cssText = 'position:absolute;left:8px;bottom:8px;max-width:90%;padding:6px 10px;background:rgba(0,0,0,.8);color:#fff;font:12px sans-serif;pointer-events:none;z-index:10';
    canvas.parentElement.appendChild(status);
  }
  status.textContent = message;
}
