export function createSingleCartInitializer<T>(
  loadCart: () => Promise<T>,
): () => Promise<T> {
  let initializationPromise: Promise<T> | null = null;

  return () => {
    if (!initializationPromise) {
      initializationPromise = loadCart().catch((error: unknown) => {
        initializationPromise = null;
        throw error;
      });
    }

    return initializationPromise;
  };
}

export class LatestCartRequest {
  private currentId = 0;

  start(): number {
    this.currentId += 1;
    return this.currentId;
  }

  isLatest(requestId: number): boolean {
    return requestId === this.currentId;
  }
}
