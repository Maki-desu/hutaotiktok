import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBlobWithProgress,
  formatByteSize,
  formatProgressDetail,
  registerNativeDownloadProgressListener,
  type DownloadProgressState,
} from "./download-progress";

describe("download-progress utilities", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("formats byte sizes and progress details cleanly", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(1536)).toBe("1.5 KB");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(
      formatProgressDetail({
        percent: 50,
        loadedBytes: 2 * 1024 * 1024,
        totalBytes: 4 * 1024 * 1024,
        etaSeconds: 5,
        status: "Downloading…",
      }),
    ).toBe("Downloading… · 2.0 MB / 4.0 MB · 5s left");
  });

  it("streams response blobs and reports exact progress when Content-Length is known", async () => {
    const chunkA = new Uint8Array(500).fill(1);
    const chunkB = new Uint8Array(500).fill(2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunkA);
        controller.enqueue(chunkB);
        controller.close();
      },
    });
    const response = new Response(stream, {
      headers: {
        "content-type": "video/mp4",
        "content-length": "1000",
      },
    });

    const updates: DownloadProgressState[] = [];
    const blob = await fetchBlobWithProgress(
      response,
      (state) => updates.push(state),
      { startPercent: 0, endPercent: 80, status: "Downloading video…" },
    );

    expect(blob.size).toBe(1000);
    expect(blob.type).toBe("video/mp4");
    expect(updates[0].percent).toBe(0);
    expect(updates.some((u) => u.percent === 40 && u.loadedBytes === 500)).toBe(true);
    expect(updates[updates.length - 1].percent).toBe(80);
  });

  it("dispatches native Android progress payloads to the matching request listener", () => {
    const received: DownloadProgressState[] = [];
    const unregister = registerNativeDownloadProgressListener("req-1", (state) => {
      received.push(state);
    });

    window.onNativeDownloadProgress?.(
      "req-1",
      JSON.stringify({ percent: 64.4, etaSeconds: 3, status: "Downloading stream…" }),
    );
    window.onNativeDownloadProgress?.("other-req", JSON.stringify({ percent: 99 }));
    unregister();
    window.onNativeDownloadProgress?.("req-1", JSON.stringify({ percent: 100 }));

    expect(received).toEqual([
      {
        percent: 64,
        loadedBytes: undefined,
        totalBytes: undefined,
        etaSeconds: 3,
        status: "Downloading stream…",
      },
    ]);
  });
});
