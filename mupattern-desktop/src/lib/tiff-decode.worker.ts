import * as UTIF from "utif2";

type WorkerSelf = {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage: (message: DecodeResponse, transfer?: Transferable[]) => void;
};

interface DecodeRequest {
  id: number;
  buffer: ArrayBuffer;
}

interface DecodeSuccess {
  id: number;
  ok: true;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

interface DecodeFailure {
  id: number;
  ok: false;
  error: string;
}

type DecodeResponse = DecodeSuccess | DecodeFailure;

const workerSelf = globalThis as unknown as WorkerSelf;

workerSelf.onmessage = (event: MessageEvent<DecodeRequest>) => {
  const { id, buffer } = event.data;
  try {
    const ifds = UTIF.decode(buffer);
    if (ifds.length === 0) {
      const fail: DecodeFailure = { id, ok: false, error: "Could not decode TIFF file" };
      workerSelf.postMessage(fail);
      return;
    }

    UTIF.decodeImage(buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const rgbaCopy = new Uint8Array(rgba.length);
    rgbaCopy.set(rgba);
    const width = ifds[0].width;
    const height = ifds[0].height;

    const payload: DecodeSuccess = {
      id,
      ok: true,
      width,
      height,
      rgba: rgbaCopy.buffer as ArrayBuffer,
    };
    workerSelf.postMessage(payload satisfies DecodeResponse, [payload.rgba]);
  } catch {
    const fail: DecodeFailure = { id, ok: false, error: "Failed to decode TIFF file" };
    workerSelf.postMessage(fail);
  }
};
