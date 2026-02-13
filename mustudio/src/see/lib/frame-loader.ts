export interface BatchLoadResult<T> {
  value: T | null;
  error: string | null;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function runBatch<Item, Value>(
  items: readonly Item[],
  loader: (item: Item) => Promise<Value>
): Promise<BatchLoadResult<Value>[]> {
  return Promise.all(
    items.map(async (item) => {
      try {
        const value = await loader(item);
        return { value, error: null };
      } catch (error) {
        return { value: null, error: formatError(error) };
      }
    })
  );
}

/**
 * Run a batch loader and retry once when every item fails.
 * This handles transient first-pass load failures without user interaction.
 */
export async function loadBatchWithRetryOnTotalFailure<Item, Value>(
  items: readonly Item[],
  loader: (item: Item) => Promise<Value>
): Promise<BatchLoadResult<Value>[]> {
  const firstAttempt = await runBatch(items, loader);
  const hasAnySuccess = firstAttempt.some((result) => result.value !== null);
  if (hasAnySuccess || items.length === 0) return firstAttempt;
  return runBatch(items, loader);
}
