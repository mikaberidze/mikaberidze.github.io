// Retry resource failures at smaller sizes; leave numerical/programming errors
// visible rather than silently treating them as a hardware capacity problem.
export function isResourceError(error) {
  return error instanceof RangeError || error?.name === 'GPUOutOfMemoryError' ||
    /out.of.memory|allocation|buffer.*limit|insufficient.*memory|device.*lost/i.test(error?.message || '');
}

export async function withSizeBackoff(config, attempt, report, isCurrent = () => true) {
  let current = { ...config };
  while (isCurrent()) {
    try { return await attempt(current); }
    catch (error) {
      if (!isCurrent() || !isResourceError(error) || current.n <= 1) throw error;
      const n = Math.max(1, Math.floor(current.n * .8));
      report({ from: current.n, n, reason: error.message });
      current = { ...current, n };
    }
  }
}
