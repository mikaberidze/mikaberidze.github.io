// Test-only worker: exercise the real fallback when the API is missing.
Object.defineProperty(navigator, 'gpu', { value: undefined });
await import('../sim-worker.js');
postMessage({ type: 'testReady' });
