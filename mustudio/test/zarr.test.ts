import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createZarrStore, discoverStore, loadFrame } from "../src/see/lib/zarr";

const discoverMock = mock(async () => ({
  positions: [],
  crops: {},
}));

const loadFrameMock = mock(async () => ({
  ok: true as const,
  width: 1,
  height: 1,
  data: new Uint16Array([0]).buffer,
}));

beforeEach(() => {
  discoverMock.mockClear();
  loadFrameMock.mockClear();

  (globalThis as { window?: unknown }).window = {
    mustudio: {
      zarr: {
        discover: discoverMock,
        loadFrame: loadFrameMock,
      },
    },
  };
});

describe("discoverStore", () => {
  it("passes metadata mode and maps ipc response", async () => {
    discoverMock.mockResolvedValueOnce({
      positions: ["140"],
      crops: {
        "140": [
          { posId: "140", cropId: "a", shape: [5, 2, 3, 32, 32] },
          { posId: "140", cropId: "b", shape: [5, 2, 3, 32, 32] },
        ],
      },
    });

    const index = await discoverStore("C:/ws", ["140"], { metadataMode: "fast" });

    expect(discoverMock).toHaveBeenCalledTimes(1);
    expect(discoverMock).toHaveBeenCalledWith({
      workspacePath: "C:/ws",
      positionFilter: ["140"],
      metadataMode: "fast",
    });
    expect(index.positions).toEqual(["140"]);
    expect(index.crops.get("140")?.map((entry) => entry.cropId)).toEqual(["a", "b"]);
  });
});

describe("loadFrame", () => {
  it("loads frame bytes from ipc and returns uint16 data", async () => {
    const frameBytes = new Uint16Array([1, 2, 3, 4]);
    loadFrameMock.mockResolvedValueOnce({
      ok: true,
      width: 2,
      height: 2,
      data: frameBytes.buffer.slice(frameBytes.byteOffset, frameBytes.byteOffset + frameBytes.byteLength),
    });

    const frame = await loadFrame(createZarrStore("C:/ws"), "140", "000", 3, 1, 2);

    expect(loadFrameMock).toHaveBeenCalledWith({
      workspacePath: "C:/ws",
      posId: "140",
      cropId: "000",
      t: 3,
      c: 1,
      z: 2,
    });
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    expect(Array.from(frame.data)).toEqual([1, 2, 3, 4]);
  });

  it("throws when ipc returns an error", async () => {
    loadFrameMock.mockResolvedValueOnce({
      ok: false,
      error: "boom",
    });

    await expect(loadFrame(createZarrStore("C:/ws"), "140", "000", 0)).rejects.toThrow("boom");
  });
});
