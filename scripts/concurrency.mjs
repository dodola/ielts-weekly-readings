export function serialQueue() {
  let tail = Promise.resolve();
  return operation => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
}

// Never schedule the same job twice. Let in-flight jobs save their work after
// one fails, then surface the failure without starting further jobs.
export async function runBounded(jobs, concurrency, operation) {
  let next = 0, failure;
  async function worker() {
    while (!failure && next < jobs.length) {
      const index = next++;
      try { await operation(jobs[index], index); }
      catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  if (failure) throw failure;
}
