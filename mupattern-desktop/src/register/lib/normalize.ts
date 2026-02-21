export { normalizeImageDataForDisplay } from "@mupattern/shared/register/lib/normalize";

interface NormalizeSuccessMessage {
  id: number;
  ok: true;
  rgba: ArrayBuffer;
}

interface NormalizeFailureMessage {
  id: number;
  ok: false;
  error: string;
}

type NormalizeMessage = NormalizeSuccessMessage | NormalizeFailureMessage;

let normalizeWorker: Worker | null = null;
let nextNormalizeId = 1;
const pendingNormalizations = new Map<
  number,
  {
    resolve: (value: ImageData) => void;
    reject: (reason?: unknown) => void;
    width: number;
    height: number;
  }
>();

function getNormalizeWorker(): Worker {
  if (normalizeWorker) return normalizeWorker;

  normalizeWorker = new Worker(new URL("./normalize.worker.ts", import.meta.url), {
    type: "module",
  });
  normalizeWorker.onmessage = (event: MessageEvent<NormalizeMessage>) => {
    const message = event.data;
    const pending = pendingNormalizations.get(message.id);
    if (!pending) return;
    pendingNormalizations.delete(message.id);

    if (!message.ok) {
      pending.reject(new Error(message.error));
      return;
    }

    const out = new Uint8ClampedArray(message.rgba);
    pending.resolve(new ImageData(out, pending.width, pending.height));
  };

  normalizeWorker.onerror = (event) => {
    for (const pending of pendingNormalizations.values()) {
      pending.reject(new Error(event.message || "Normalization worker failed"));
    }
    pendingNormalizations.clear();
  };

  return normalizeWorker;
}

export function normalizeImageDataForDisplayAsync(data: ImageData): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const id = nextNormalizeId++;
    const payload = new Uint8ClampedArray(data.data.length);
    payload.set(data.data);
    pendingNormalizations.set(id, {
      resolve,
      reject,
      width: data.width,
      height: data.height,
    });
    const worker = getNormalizeWorker();
    worker.postMessage(
      { id, width: data.width, height: data.height, rgba: payload.buffer as ArrayBuffer },
      [payload.buffer as ArrayBuffer],
    );
  });
}
