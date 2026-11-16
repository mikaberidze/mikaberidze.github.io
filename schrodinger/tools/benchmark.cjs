// CPU-only audit harness: node schrodinger/tools/benchmark.cjs
// Canvas allocation is included; browser painting, compositing and GPU work are excluded.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const source = ['constants.js', 'quantum-gpu.js', 'quantum.js'].map(file =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const harness = `
function setup(w,h) {
  canvas = {width:w,height:h};
  ctx = {clearRect(){}, createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)}},putImageData(){}};
  initSimulationGrid(w,h); initPotentialField(w,h);
  initialPsiDirty = false; showEnergy = false; boundaryMode = 'open';
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x, a=Math.exp(-((x-w/2)**2+(y-h/2)**2)/(2*(w*.08)**2));
    psiRe[i]=a*Math.cos(x*.2); psiIm[i]=a*Math.sin(x*.2);
    potentialField[i]=x>w*.7?.5:0;
  }
}
function measure(fn) {
  for(let i=0;i<15;i++) fn();
  const samples=[];
  for(let j=0;j<7;j++) {const t=performance.now(); for(let i=0;i<5;i++) fn(); samples.push((performance.now()-t)/5);}
  return +samples.sort((a,b)=>a-b)[3].toFixed(3);
}
const results=[];
for(const [w,h] of [[400,300],[800,600],[1600,1200]]) {
  setup(w,h);
  results.push({resolution:w+'x'+h,solver_ms:measure(stepSchrodinger),
    energy_ms:measure(computeEnergyExpectation),range_ms:measure(getPotentialRange),
    color_and_buffer_ms:measure(drawScene)});
}
const modes=[];
for(const v of [0,1,2,4]) {
  setup(32,24); boundaryMode='closed'; psiRe.fill(1); psiIm.fill(0); potentialField.fill(v);
  stepSchrodinger();
  modes.push({constantPotential:v,oneStepRe:psiRe[0],oneStepIm:psiIm[0],oneStepProbabilityRatio:psiRe[0]**2+psiIm[0]**2});
}
return {results,modes};
`;
const result = new Function(source + '\n' + harness)();
console.log(JSON.stringify({node:process.version,cpu:os.cpus()[0].model,...result},null,2));
