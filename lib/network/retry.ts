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
  // Um 500 muito rápido do WordPress costuma indicar falha interna já
  // consumada (por exemplo, conexão MySQL indisponível). Repeti-lo durante
  // uma rajada de renderização apenas multiplica a pressão no origin.
  return status === 429 || status === 502 || status === 503 || status === 504;
}
