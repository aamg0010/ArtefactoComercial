/** Bounds even injected dependencies that ignore cancellation; always clears its timer. */
export async function withinBudget<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('TIME_BUDGET')); }, Math.max(0, milliseconds)); }),
      work(controller.signal),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}
