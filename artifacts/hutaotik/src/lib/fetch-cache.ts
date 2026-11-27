export interface TimedCache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
}

export function normalizeFetchCacheKey(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function createTimedCache<T>(ttlMs = 300_000, maxEntries = 80): TimedCache<T> {
  const store = new Map<string, { expiresAt: number; value: T }>();

  return {
    get(key: string): T | null {
      const normalized = normalizeFetchCacheKey(key);
      if (!normalized) return null;
      const entry = store.get(normalized);
      if (!entry) return null;
      if (entry.expiresAt <= Date.now()) {
        store.delete(normalized);
        return null;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      const normalized = normalizeFetchCacheKey(key);
      if (!normalized) return;
      if (store.size >= maxEntries && !store.has(normalized)) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) store.delete(oldestKey);
      }
      store.set(normalized, { expiresAt: Date.now() + ttlMs, value });
    },
    delete(key: string): void {
      store.delete(normalizeFetchCacheKey(key));
    },
    clear(): void {
      store.clear();
    },
  };
}

export function createLinkedAbortController(
  outerSignal?: AbortSignal,
  timeoutMs?: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const onOuterAbort = () => {
    controller.abort(outerSignal?.reason);
  };
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (outerSignal) {
    if (outerSignal.aborted) {
      controller.abort(outerSignal.reason);
    } else {
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }
  }

  if (typeof timeoutMs === "number" && timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(new DOMException("Request timed out.", "TimeoutError"));
    }, timeoutMs);
  }

  const cleanup = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (outerSignal) {
      outerSignal.removeEventListener("abort", onOuterAbort);
    }
  };

  return { controller, cleanup };
}

/**
 * Runs multiple async fetch strategies in parallel and resolves as soon as the first one succeeds,
 * immediately aborting slower siblings. Rejects only if all strategies fail or outerSignal aborts.
 */
export function raceFastest<T>(
  tasks: Array<(signal: AbortSignal) => Promise<T>>,
  outerSignal?: AbortSignal,
): Promise<T> {
  if (tasks.length === 0) {
    return Promise.reject(new Error("No fetch providers were configured."));
  }
  if (outerSignal?.aborted) {
    return Promise.reject(
      outerSignal.reason instanceof Error
        ? outerSignal.reason
        : new DOMException("Aborted", "AbortError"),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const controllers = tasks.map(() => new AbortController());
    const errors: unknown[] = new Array(tasks.length);
    let settled = false;
    let remaining = tasks.length;

    const cleanupAll = () => {
      if (outerSignal) {
        outerSignal.removeEventListener("abort", onOuterAbort);
      }
      controllers.forEach((ctrl) => {
        if (!ctrl.signal.aborted) ctrl.abort();
      });
    };

    const onOuterAbort = () => {
      if (settled) return;
      settled = true;
      cleanupAll();
      reject(
        outerSignal?.reason instanceof Error
          ? outerSignal.reason
          : new DOMException("Aborted", "AbortError"),
      );
    };

    if (outerSignal) {
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    }

    tasks.forEach((task, index) => {
      const ctrl = controllers[index];
      Promise.resolve()
        .then(() => task(ctrl.signal))
        .then(
          (value) => {
            if (settled) return;
            settled = true;
            if (outerSignal) {
              outerSignal.removeEventListener("abort", onOuterAbort);
            }
            controllers.forEach((other, otherIndex) => {
              if (otherIndex !== index && !other.signal.aborted) {
                other.abort();
              }
            });
            resolve(value);
          },
          (err) => {
            if (settled) return;
            errors[index] = err;
            remaining -= 1;
            if (remaining === 0) {
              settled = true;
              if (outerSignal) {
                outerSignal.removeEventListener("abort", onOuterAbort);
              }
              const preferred =
                errors.find((item) => item instanceof Error && item.name !== "AbortError") ??
                errors.find((item) => item instanceof Error) ??
                new Error("All fetch providers failed.");
              reject(preferred);
            }
          },
        );
    });
  });
}
