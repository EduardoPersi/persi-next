export interface RetryOptions<T> {
  shouldRetryResult(result: T): boolean;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onRetry?: (reason: "result" | "error") => void;
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function withSingleRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions<T>,
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;

  try {
    const result = await operation();
    if (!options.shouldRetryResult(result)) return result;
    options.onRetry?.("result");
  } catch {
    options.onRetry?.("error");
  }

  await sleep(options.delayMs ?? 150);
  return operation();
}

export function isTransientHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
