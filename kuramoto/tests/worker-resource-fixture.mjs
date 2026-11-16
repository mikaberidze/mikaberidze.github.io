// Node-only fixture for exercising the real worker queue with allocation faults.
import { parentPort, workerData } from 'node:worker_threads';
import { GpuEngine } from '../sim-gpu.js';
GpuEngine.graphCapacity = async () => workerData.capacity ?? Infinity;
GpuEngine.create = async graph => {
  if (graph.n > (workerData.maxNodes ?? Infinity)) throw new RangeError('GPU allocation failed');
  throw new Error('WebGPU unavailable in test');
};
globalThis.postMessage = message => parentPort.postMessage(message);
globalThis.onmessage = null;
await import('../sim-worker.js');
parentPort.on('message', data => globalThis.onmessage({data}));
parentPort.postMessage({type:'booted'});
