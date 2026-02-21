interface NormalizeRequest {
  id: number;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

interface NormalizeSuccess {
  id: number;
  ok: true;
  rgba: ArrayBuffer;
}

interface NormalizeFailure {
  id: number;
  ok: false;
  error: string;
}

type NormalizeResponse = NormalizeSuccess | NormalizeFailure;

type WorkerSelf = {
  onmessage: ((event: MessageEvent<NormalizeRequest>) => void) | null;
  postMessage: (message: NormalizeResponse, transfer?: Transferable[]) => void;
};

const workerSelf = globalThis as unknown as WorkerSelf;

workerSelf.onmessage = (event: MessageEvent<NormalizeRequest>) => {
  const { id, width, height, rgba } = event.data;
  try {
    const d = new Uint8ClampedArray(rgba);
    const n = width * height;

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }

    if (max > min) {
      const scale = 255 / (max - min);
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
        const newLum = (lum - min) * scale;
        const factor = lum > 0 ? newLum / lum : 0;
        d[j] = Math.min(255, d[j] * factor);
        d[j + 1] = Math.min(255, d[j + 1] * factor);
        d[j + 2] = Math.min(255, d[j + 2] * factor);
      }
    }

    workerSelf.postMessage({ id, ok: true, rgba: d.buffer as ArrayBuffer }, [
      d.buffer as ArrayBuffer,
    ]);
  } catch {
    workerSelf.postMessage({ id, ok: false, error: "Failed to normalize image" });
  }
};
