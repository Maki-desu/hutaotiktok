import { describe, expect, it } from "vitest";
import { createTimedCache, raceFastest } from "./fetch-cache";

describe("fetch-cache", () => {
  it("stores, normalizes keys, and expires cached entries", () => {
    const cache = createTimedCache<string>(50, 2);
    cache.set(" https://example.com/a/ ", "alpha");
    expect(cache.get("https://example.com/a")).toBe("alpha");

    cache.set("https://example.com/b", "beta");
    cache.set("https://example.com/c", "gamma");
    // Oldest entry evicted at maxEntries=2
    expect(cache.get("https://example.com/a")).toBeNull();
    expect(cache.get("https://example.com/b")).toBe("beta");
    expect(cache.get("https://example.com/c")).toBe("gamma");
  });

  it("returns the fastest successful provider and aborts slower siblings", async () => {
    let slowAborted = false;

    const result = await raceFastest<string>([
      (signal) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve("slow"), 400);
          signal.addEventListener("abort", () => {
            slowAborted = true;
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      async () => {
        await new Promise((r) => setTimeout(r, 15));
        return "fast";
      },
    ]);

    expect(result).toBe("fast");
    expect(slowAborted).toBe(true);
  });

  it("still succeeds when one provider fails immediately and another resolves", async () => {
    const result = await raceFastest<string>([
      async () => {
        throw new Error("Provider 1 down");
      },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "backup-ok";
      },
    ]);

    expect(result).toBe("backup-ok");
  });

  it("rejects with a real error when every provider fails", async () => {
    await expect(
      raceFastest<string>([
        async () => {
          throw new Error("Network failure");
        },
        async () => {
          throw new Error("Server 502");
        },
      ]),
    ).rejects.toThrow("Network failure");
  });
});
