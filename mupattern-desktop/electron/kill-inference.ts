/**
 * Kill predict: ONNX inference for binary cell presence (absent/present).
 * Expects model dir with model.onnx and preprocessor_config.json.
 * Input: NCHW float32 [1, 3, 224, 224], ImageNet normalization.
 */

import path from "node:path";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import sharp from "sharp";

const IMAGE_SIZE = 224;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export interface KillPredictRow {
  t: number;
  crop: string;
  label: boolean;
}

export interface KillPredictResult {
  ok: true;
  output: string;
  rows: KillPredictRow[];
}

export interface KillPredictError {
  ok: false;
  error: string;
}

export type KillPredictResponse = KillPredictResult | KillPredictError;

/** Min-max normalize uint16 frame to 0-255, return Uint8Array */
function normalizeFrame(frame: Uint16Array): Uint8Array {
  const out = new Uint8Array(frame.length);
  let min = frame[0];
  let max = frame[0];
  for (let i = 1; i < frame.length; i++) {
    if (frame[i] < min) min = frame[i];
    if (frame[i] > max) max = frame[i];
  }
  const range = max - min;
  for (let i = 0; i < frame.length; i++) {
    out[i] = range > 0 ? Math.round(((frame[i] - min) / range) * 255) : 0;
  }
  return out;
}

/** Resize grayscale (H,W) to 224x224, return raw RGBA (sharp uses 4 ch by default) - we'll take R channel and triple it for RGB */
async function resizeTo224(raw: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const buf = await sharp(raw, {
    raw: { width, height, channels: 1 },
  })
    .resize(IMAGE_SIZE, IMAGE_SIZE)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(buf.data);
}

/** Convert 224x224 grayscale to NCHW float32 with ImageNet normalization */
function toNchwNormalized(gray224: Uint8Array): Float32Array {
  const out = new Float32Array(1 * 3 * IMAGE_SIZE * IMAGE_SIZE);
  const n = IMAGE_SIZE * IMAGE_SIZE;
  for (let i = 0; i < n; i++) {
    const v = gray224[i] / 255;
    for (let c = 0; c < 3; c++) {
      out[c * n + i] = (v - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return out;
}

let onnxModule: typeof import("onnxruntime-node") | null = null;
async function getOnnx() {
  if (!onnxModule) onnxModule = await import("onnxruntime-node");
  return onnxModule;
}

const sessionCache = new Map<string, InferenceSession>();

export async function runKillPredict(params: {
  workspacePath: string;
  pos: number;
  modelPath: string;
  output?: string;
  batchSize?: number;
  tStart?: number;
  tEnd?: number;
  cropStart?: number;
  cropEnd?: number;
  getCropChunk: (
    workspacePath: string,
    posId: string,
    cropId: string,
    t: number,
    c: number,
    z: number,
  ) => Promise<{ data: Uint16Array; height: number; width: number }>;
  getCropShape: (workspacePath: string, posId: string, cropId: string) => Promise<{ nT: number }>;
  listCrops: (workspacePath: string, posId: string) => Promise<string[]>;
  sendProgress?: (progress: number, message: string) => void;
}): Promise<KillPredictResponse> {
  const {
    workspacePath,
    pos,
    modelPath,
    output,
    batchSize = 64,
    getCropChunk,
    listCrops,
    sendProgress,
  } = params;

  const posId = String(pos).padStart(3, "0");
  const cropIds = await listCrops(workspacePath, posId);
  if (cropIds.length === 0) {
    return { ok: false, error: "No crops found for position" };
  }

  const tStart = params.tStart ?? 0;
  const tEnd = params.tEnd ?? undefined;
  const cropStart = params.cropStart ?? 0;
  const cropEnd = params.cropEnd ?? cropIds.length;

  const filteredCropIds = cropIds
    .filter((id) => {
      const idx = cropIds.indexOf(id);
      return idx >= cropStart && idx < cropEnd;
    })
    .sort();

  const getCropShape = params.getCropShape;
  if (!getCropShape) {
    return { ok: false, error: "getCropShape is required" };
  }

  const pairs: Array<{ t: number; crop: string }> = [];
  for (const cropId of filteredCropIds) {
    let nT: number;
    try {
      const shape = await getCropShape(workspacePath, posId, cropId);
      nT = shape.nT;
    } catch {
      continue;
    }
    const endT = tEnd != null ? Math.min(tEnd, nT) : nT;
    for (let t = tStart; t < endT; t++) {
      pairs.push({ t, crop: cropId });
    }
  }

  if (pairs.length === 0) {
    const outPath = output ?? "";
    if (output) {
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, "t,crop,label\n", "utf8");
    }
    return { ok: true, output: outPath, rows: [] };
  }

  const onnx = await getOnnx();
  const modelFile = path.join(modelPath, "model.onnx");
  let session = sessionCache.get(modelFile);
  if (!session) {
    session = await onnx.InferenceSession.create(modelFile, {
      executionProviders: ["cpu"],
    });
    sessionCache.set(modelFile, session);
  }

  const inputName = session.inputNames[0];
  const rows: KillPredictRow[] = [];
  const total = pairs.length;
  let processed = 0;

  for (let i = 0; i < pairs.length; i += batchSize) {
    const batch = pairs.slice(i, i + batchSize);
    const tensors: Float32Array[] = [];

    for (const { t, crop } of batch) {
      const { data, height, width } = await getCropChunk(workspacePath, posId, crop, t, 0, 0);
      const normalized = normalizeFrame(data);
      const resized = await resizeTo224(normalized, width, height);
      const input = toNchwNormalized(resized);
      tensors.push(input);
    }

    const batchTensor = new Float32Array(batch.length * 3 * IMAGE_SIZE * IMAGE_SIZE);
    for (let b = 0; b < tensors.length; b++) {
      batchTensor.set(tensors[b], b * 3 * IMAGE_SIZE * IMAGE_SIZE);
    }

    const tensor = new onnx.Tensor("float32", batchTensor, [
      batch.length,
      3,
      IMAGE_SIZE,
      IMAGE_SIZE,
    ]);
    const result = await session.run({ [inputName]: tensor });
    const logits = result[session.outputNames[0]] as Tensor;
    const data = logits.data as Float32Array;
    const numClasses = logits.dims[logits.dims.length - 1] ?? 2;

    for (let b = 0; b < batch.length; b++) {
      let maxIdx = 0;
      let maxVal = data[b * numClasses];
      for (let c = 1; c < numClasses; c++) {
        const v = data[b * numClasses + c];
        if (v > maxVal) {
          maxVal = v;
          maxIdx = c;
        }
      }
      rows.push({
        t: batch[b].t,
        crop: batch[b].crop,
        label: maxIdx === 1,
      });
    }

    processed += batch.length;
    if (sendProgress && total > 0) {
      sendProgress(processed / total, `Predicting ${processed}/${total}`);
    }
  }

  const outPath = output ?? "";
  if (output) {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(output), { recursive: true });
    const lines = [
      "t,crop,label",
      ...rows.map((r) => `${r.t},${r.crop},${String(r.label).toLowerCase()}`),
    ];
    await writeFile(output, lines.join("\n"), "utf8");
    if (sendProgress) sendProgress(1, `Wrote ${rows.length} rows to ${output}`);
  }

  return { ok: true, output: outPath, rows };
}
