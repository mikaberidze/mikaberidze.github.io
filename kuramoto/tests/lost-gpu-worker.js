// Test-only fault injection: destroy the device after initial configuration.
import { GpuEngine } from '../sim-gpu.js';
const create = GpuEngine.create;
GpuEngine.create = async function (...args) {
  const engine = await create.apply(this, args), batch = engine.batch.bind(engine);
  let calls = 0;
  engine.batch = async schedule => {
    if (++calls === 2) engine.device.destroy();
    return batch(schedule);
  };
  return engine;
};
await import('../sim-worker.js');
postMessage({ type: 'testReady' });
