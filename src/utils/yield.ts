/**
 * Helpers for long main-thread work. Awaiting an already-resolved promise
 * never gives the browser a chance to paint, so synchronous work such as
 * MuPDF parsing must yield explicitly for progress to show.
 */

/** Resolves after the browser has painted the current state */
export function nextPaint(): Promise<void> {
  return new Promise(resolve => {
    // rAF runs just before a paint; the timeout runs after it
    requestAnimationFrame(() => setTimeout(resolve, 0));
    // Hidden tabs don't run rAF, so don't wait on it forever
    setTimeout(resolve, 100);
  });
}

/**
 * Returns a function to call between units of work. It yields to the
 * browser once `budgetMs` has passed since the last yield, so short jobs
 * don't slow down while long ones still paint progress.
 */
export function createYielder(budgetMs = 50): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < budgetMs) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    last = performance.now();
  };
}
