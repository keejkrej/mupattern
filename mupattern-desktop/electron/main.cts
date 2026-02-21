import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import initSqlJs, { type Database } from "sql.js";
import * as UTIF from "utif2";
import type { Array as ZarritaArray, DataType, Location } from "zarrita";
import type { Readable } from "@zarrita/storage";
import type FileSystemStore from "@zarrita/storage/fs";

const DEV_SERVER_URL = "http://localhost:5173";
const WORKSPACE_DB_FILENAME = "mupattern-desktop.sqlite";
const WORKSPACE_STATE_KEY = "workspace-state";
const TIFF_RE = /^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$/i;

interface WorkspaceScanResult {
  path: string;
  name: string;
  positions: number[];
  channels: number[];
  times: number[];
  zSlices: number[];
}

interface ReadPositionImageRequest {
  workspacePath: string;
  pos: number;
  channel: number;
  time: number;
  z: number;
}

interface ReadPositionImageSuccess {
  ok: true;
  baseName: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
}

interface ReadPositionImageFailure {
  ok: false;
  error: string;
}

type ReadPositionImageResponse = ReadPositionImageSuccess | ReadPositionImageFailure;

interface SaveBboxCsvRequest {
  workspacePath: string;
  pos: number;
  csv: string;
}

interface DiscoverZarrRequest {
  workspacePath: string;
  positionFilter?: string[];
  metadataMode?: "full" | "fast";
}

interface DiscoverZarrResponse {
  positions: string[];
  crops: Record<string, Array<{ posId: string; cropId: string; shape: number[] }>>;
}

interface LoadZarrFrameRequest {
  workspacePath: string;
  posId: string;
  cropId: string;
  t: number;
  c: number;
  z: number;
}

interface LoadZarrFrameSuccess {
  ok: true;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface LoadZarrFrameFailure {
  ok: false;
  error: string;
}

type LoadZarrFrameResponse = LoadZarrFrameSuccess | LoadZarrFrameFailure;

interface RunCropRequest {
  taskId: string;
  input_dir: string;
  pos: number;
  bbox: string;
  output: string;
  background: boolean;
}

interface RunCropSuccess {
  ok: true;
}

interface RunCropFailure {
  ok: false;
  error: string;
}

type RunCropResponse = RunCropSuccess | RunCropFailure;

interface RunConvertRequest {
  taskId: string;
  input: string;
  output: string;
  pos: string;
  time: string;
}

interface RunConvertSuccess {
  ok: true;
}

interface RunConvertFailure {
  ok: false;
  error: string;
}

type RunConvertResponse = RunConvertSuccess | RunConvertFailure;

interface RunMovieRequest {
  taskId: string;
  input_zarr: string;
  pos: number;
  crop: number;
  channel: number;
  time: string;
  output: string;
  fps: number;
  colormap: string;
  spots: string | null;
}

interface RunMovieSuccess {
  ok: true;
}

interface RunMovieFailure {
  ok: false;
  error: string;
}

type RunMovieResponse = RunMovieSuccess | RunMovieFailure;

interface HasMasksRequest {
  /** Absolute path to masks zarr folder (e.g. .../masks_fl.zarr). No default. */
  masksPath: string;
}

interface HasMasksResponse {
  hasMasks: boolean;
}

interface ExpressionAnalyzeRow {
  t: number;
  crop: string;
  intensity: number;
  area: number;
  background: number;
}

interface RunExpressionAnalyzeRequest {
  taskId: string;
  workspacePath: string;
  pos: number;
  channel: number;
  output: string;
}

interface RunExpressionAnalyzeSuccess {
  ok: true;
  output: string;
  rows: ExpressionAnalyzeRow[];
}

interface RunExpressionAnalyzeFailure {
  ok: false;
  error: string;
}

type RunExpressionAnalyzeResponse = RunExpressionAnalyzeSuccess | RunExpressionAnalyzeFailure;

interface RunKillPredictRequest {
  taskId: string;
  workspacePath: string;
  pos: number;
  modelPath: string;
  output: string;
  batchSize?: number;
  tStart?: number;
  tEnd?: number;
  cropStart?: number;
  cropEnd?: number;
}

interface KillPredictRow {
  t: number;
  crop: string;
  label: boolean;
}

interface RunKillPredictSuccess {
  ok: true;
  output: string;
  rows: KillPredictRow[];
}

interface RunKillPredictFailure {
  ok: false;
  error: string;
}

type RunKillPredictResponse = RunKillPredictSuccess | RunKillPredictFailure;

interface LoadMaskFrameRequest {
  masksPath: string;
  posId: string;
  cropId: string;
  t: number;
}

interface LoadMaskFrameSuccess {
  ok: true;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface LoadMaskFrameFailure {
  ok: false;
  error: string;
}

type LoadMaskFrameResponse = LoadMaskFrameSuccess | LoadMaskFrameFailure;

type ZarrArrayHandle = ZarritaArray<DataType, Readable>;
type ZarrChunk = Awaited<ReturnType<ZarrArrayHandle["getChunk"]>>;
type ZarrLocation = Location<Readable>;

interface ZarrContext {
  root: ZarrLocation;
  arrays: Map<string, Promise<ZarrArrayHandle>>;
}

let workspaceDb: Database | null = null;
let zarrModulePromise: Promise<typeof import("zarrita")> | null = null;
let fsStoreCtorPromise: Promise<typeof FileSystemStore> | null = null;
const zarrContextByWorkspacePath = new Map<string, ZarrContext>();
/** Keyed by absolute masks zarr path (user picks via Load). */
const masksContextByMasksPath = new Map<string, ZarrContext>();

function getWorkspaceDbPath(): string {
  return path.join(app.getPath("userData"), WORKSPACE_DB_FILENAME);
}

function getMupatternBinPath(): string {
  const exe = process.platform === "win32" ? "mupattern.exe" : "mupattern";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", exe);
  }
  // Use absolute path: from electron-dist/ go up to workspace root, then mupattern-rs/target/
  const root = path.resolve(__dirname, "..", "..", "mupattern-rs", "target");
  const releasePath = path.join(root, "release", exe);
  const debugPath = path.join(root, "debug", exe);
  try {
    accessSync(releasePath, constants.R_OK);
    return releasePath;
  } catch {
    try {
      accessSync(debugPath, constants.R_OK);
      return debugPath;
    } catch {
      return releasePath; // let spawn fail with ENOENT and show path in error
    }
  }
}

async function parseExpressionCsv(csvPath: string): Promise<ExpressionAnalyzeRow[]> {
  try {
    const content = await readFile(csvPath, "utf8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];
    const rows: ExpressionAnalyzeRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length >= 5) {
        rows.push({
          t: Number.parseInt(parts[0], 10),
          crop: parts[1].trim(),
          intensity: Number.parseInt(parts[2], 10),
          area: Number.parseInt(parts[3], 10),
          background: Number.parseFloat(parts[4]),
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

async function runMupatternSubprocess(
  args: string[],
  sendProgress: (progress: number, message: string) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const binPath = getMupatternBinPath();
  return new Promise((resolve) => {
    const proc = spawn(binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      stderr += s;
      const lines = s.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as { progress?: number; message?: string };
          if (typeof obj.progress === "number" && typeof obj.message === "string") {
            sendProgress(obj.progress, obj.message);
          }
        } catch {
          // not JSON, ignore
        }
      }
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const trimmed = stderr.trim();
        const lines = trimmed
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        let errMsg =
          lines.length > 0 ? lines.slice(-5).join("\n") : `Process exited with code ${code}`;
        if (errMsg.includes("unrecognized subcommand") && args[0] === "convert") {
          errMsg += `\n\nRebuild mupattern-rs: cd mupattern-rs && cargo build --release`;
        }
        resolve({ ok: false, error: errMsg });
      }
    });
    proc.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

function posDirName(pos: number): string {
  return `Pos${pos}`;
}

/** Format: img_channel{C:03d}_position{P:03d}_time{T:09d}_z{Z:03d}.tif */
function buildTifFilename(pos: number, channel: number, time: number, z: number): string {
  return `img_channel${String(channel).padStart(3, "0")}_position${String(pos).padStart(3, "0")}_time${String(time).padStart(9, "0")}_z${String(z).padStart(3, "0")}.tif`;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function normalizeRgbaInPlace(rgba: Uint8Array, width: number, height: number): void {
  const n = width * height;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < n; i += 1) {
    const j = i * 4;
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  if (max <= min) return;

  const scale = 255 / (max - min);
  for (let i = 0; i < n; i += 1) {
    const j = i * 4;
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    const newLum = (lum - min) * scale;
    const factor = lum > 0 ? newLum / lum : 0;
    rgba[j] = Math.max(0, Math.min(255, Math.round(rgba[j] * factor)));
    rgba[j + 1] = Math.max(0, Math.min(255, Math.round(rgba[j + 1] * factor)));
    rgba[j + 2] = Math.max(0, Math.min(255, Math.round(rgba[j + 2] * factor)));
  }
}

function parsePosDirName(name: string): number | null {
  const match = name.match(/^Pos(\d+)$/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function scanWorkspaceDirectory(workspacePath: string): Promise<WorkspaceScanResult | null> {
  const entries = await readdir(workspacePath, { withFileTypes: true });
  const positions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parsePosDirName(entry.name))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);

  const channels = new Set<number>();
  const times = new Set<number>();
  const zSlices = new Set<number>();
  if (positions.length > 0) {
    const firstPosPath = path.join(workspacePath, posDirName(positions[0]));
    const firstPosEntries = await readdir(firstPosPath, { withFileTypes: true });
    for (const entry of firstPosEntries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(TIFF_RE);
      if (!match) continue;
      channels.add(Number.parseInt(match[1], 10));
      times.add(Number.parseInt(match[3], 10));
      zSlices.add(Number.parseInt(match[4], 10));
    }
  }

  return {
    path: workspacePath,
    name: path.basename(workspacePath),
    positions,
    channels: [...channels].sort((a, b) => a - b),
    times: [...times].sort((a, b) => a - b),
    zSlices: [...zSlices].sort((a, b) => a - b),
  };
}

async function pickWorkspaceDirectory(): Promise<WorkspaceScanResult | null> {
  const result = await dialog.showOpenDialog({
    title: "Select workspace folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const workspacePath = result.filePaths[0];
  await access(workspacePath, constants.R_OK);
  return scanWorkspaceDirectory(workspacePath);
}

async function readAndNormalizePositionImage(
  request: ReadPositionImageRequest,
): Promise<ReadPositionImageResponse> {
  try {
    const filename = buildTifFilename(request.pos, request.channel, request.time, request.z);
    const filePath = path.join(request.workspacePath, posDirName(request.pos), filename);
    const fileBytes = await readFile(filePath);
    const buffer = toArrayBuffer(fileBytes);
    const ifds = UTIF.decode(buffer);
    if (ifds.length === 0) {
      return { ok: false, error: "Could not decode TIFF file." };
    }

    UTIF.decodeImage(buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const width = ifds[0].width;
    const height = ifds[0].height;
    normalizeRgbaInPlace(rgba, width, height);

    const rgbaCopy = new Uint8Array(rgba.length);
    rgbaCopy.set(rgba);

    return {
      ok: true,
      baseName: path.parse(filename).name,
      width,
      height,
      rgba: toArrayBuffer(rgbaCopy),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to load workspace image." };
  }
}

async function saveBboxCsvToWorkspace({
  workspacePath,
  pos,
  csv,
}: SaveBboxCsvRequest): Promise<boolean> {
  const filePath = path.join(workspacePath, `${posDirName(pos)}_bbox.csv`);
  await writeFile(filePath, csv, "utf8");
  return true;
}

async function getZarrDeps(): Promise<{
  zarr: typeof import("zarrita");
  FileSystemStore: typeof FileSystemStore;
}> {
  if (!zarrModulePromise) {
    zarrModulePromise = import("zarrita");
  }
  if (!fsStoreCtorPromise) {
    fsStoreCtorPromise = import("@zarrita/storage/fs").then((module) => module.default);
  }
  return {
    zarr: await zarrModulePromise,
    FileSystemStore: await fsStoreCtorPromise,
  };
}

async function getZarrContext(workspacePath: string): Promise<ZarrContext> {
  const existing = zarrContextByWorkspacePath.get(workspacePath);
  if (existing) return existing;

  const { zarr, FileSystemStore } = await getZarrDeps();
  const zarrPath = path.join(workspacePath, "crops.zarr");
  const store = new FileSystemStore(zarrPath);
  const root: ZarrLocation = zarr.root(store);
  const context: ZarrContext = { root, arrays: new Map() };
  zarrContextByWorkspacePath.set(workspacePath, context);
  return context;
}

async function getMasksContext(masksPath: string): Promise<ZarrContext> {
  const existing = masksContextByMasksPath.get(masksPath);
  if (existing) return existing;

  const { zarr, FileSystemStore } = await getZarrDeps();
  const store = new FileSystemStore(masksPath);
  const root: ZarrLocation = zarr.root(store);
  const context: ZarrContext = { root, arrays: new Map() };
  masksContextByMasksPath.set(masksPath, context);
  return context;
}

async function getCachedMasksArray(
  masksPath: string,
  posId: string,
  cropId: string,
): Promise<ZarrArrayHandle> {
  const context = await getMasksContext(masksPath);
  const key = `${posId}/${cropId}`;
  let promise = context.arrays.get(key);
  if (!promise) {
    const { zarr } = await getZarrDeps();
    promise = zarr.open.v3(context.root.resolve(`pos/${posId}/crop/${cropId}`), { kind: "array" });
    promise.catch(() => {
      const current = context.arrays.get(key);
      if (current === promise) context.arrays.delete(key);
    });
    context.arrays.set(key, promise);
  }
  return promise;
}

async function getCachedZarrArray(
  workspacePath: string,
  posId: string,
  cropId: string,
): Promise<ZarrArrayHandle> {
  const context = await getZarrContext(workspacePath);
  const key = `${posId}/${cropId}`;
  let promise = context.arrays.get(key);
  if (!promise) {
    const { zarr } = await getZarrDeps();
    promise = zarr.open.v3(context.root.resolve(`pos/${posId}/crop/${cropId}`), { kind: "array" });
    promise.catch(() => {
      const current = context.arrays.get(key);
      if (current === promise) context.arrays.delete(key);
    });
    context.arrays.set(key, promise);
  }
  return promise;
}

/** Read shape from Zarr v3 array metadata. Only accepts v3 format (zarr.json). */
async function readShapeFromV3ArrayMeta(cropPath: string): Promise<number[] | null> {
  try {
    // cropPath = .../crops.zarr/pos/{posId}/crop/{cropId}; v3 metadata is colocated at zarr.json
    const metaPath = path.join(cropPath, "zarr.json");
    const text = await readFile(metaPath, "utf8");
    const parsed = JSON.parse(text) as {
      zarr_format?: number;
      node_type?: string;
      shape?: unknown;
    };
    if (parsed.zarr_format !== 3 || parsed.node_type !== "array") return null;
    if (!Array.isArray(parsed.shape)) return null;
    const shape = parsed.shape.filter((value): value is number => typeof value === "number");
    return shape.length >= 5 ? shape : null;
  } catch {
    return null;
  }
}

/** Resolve requested pos id to actual dir name under posRoot (e.g. 58 → 058 for Python layout). */
async function resolvePosIds(posRoot: string, positionFilter: string[]): Promise<string[]> {
  let dirNames: string[];
  try {
    const entries = await readdir(posRoot, { withFileTypes: true });
    dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const resolved: string[] = [];
  for (const requested of positionFilter) {
    if (dirNames.includes(requested)) {
      resolved.push(requested);
      continue;
    }
    const asNum = Number.parseInt(requested, 10);
    if (!Number.isNaN(asNum)) {
      const padded = String(asNum).padStart(3, "0");
      if (dirNames.includes(padded)) {
        resolved.push(padded);
        continue;
      }
    }
    resolved.push(requested);
  }
  return resolved;
}

async function discoverZarr({
  workspacePath,
  positionFilter,
  metadataMode = "full",
}: DiscoverZarrRequest): Promise<DiscoverZarrResponse> {
  const response: DiscoverZarrResponse = { positions: [], crops: {} };
  const posRoot = path.join(workspacePath, "crops.zarr", "pos");

  let discoveredPosIds: string[];
  if (positionFilter && positionFilter.length > 0) {
    discoveredPosIds = await resolvePosIds(posRoot, positionFilter);
  } else {
    try {
      const entries = await readdir(posRoot, { withFileTypes: true });
      discoveredPosIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return response;
    }
  }

  for (const posId of discoveredPosIds) {
    const cropRoot = path.join(posRoot, posId, "crop");
    let cropIds: string[];
    try {
      const entries = await readdir(cropRoot, { withFileTypes: true });
      cropIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }

    if (cropIds.length === 0) continue;

    response.positions.push(posId);
    const infos: Array<{ posId: string; cropId: string; shape: number[] }> = [];
    if (metadataMode === "fast") {
      const firstShape = (await readShapeFromV3ArrayMeta(path.join(cropRoot, cropIds[0]))) ?? [
        1, 1, 1, 1, 1,
      ];
      for (const cropId of cropIds) {
        infos.push({ posId, cropId, shape: firstShape });
      }
    } else {
      for (const cropId of cropIds) {
        try {
          const arr = await getCachedZarrArray(workspacePath, posId, cropId);
          infos.push({ posId, cropId, shape: [...arr.shape] });
        } catch {
          // skip crop if it can't be opened
        }
      }
    }
    response.crops[posId] = infos;
  }

  return response;
}

async function loadZarrFrame({
  workspacePath,
  posId,
  cropId,
  t,
  c,
  z,
}: LoadZarrFrameRequest): Promise<LoadZarrFrameResponse> {
  const key = `${posId}/${cropId}`;
  try {
    const context = await getZarrContext(workspacePath);
    let arr = await getCachedZarrArray(workspacePath, posId, cropId);
    let chunk: ZarrChunk;
    try {
      chunk = await arr.getChunk([t, c, z, 0, 0]);
    } catch {
      context.arrays.delete(key);
      arr = await getCachedZarrArray(workspacePath, posId, cropId);
      chunk = await arr.getChunk([t, c, z, 0, 0]);
    }

    const source = chunk.data;
    const typed =
      source instanceof Uint16Array ? source : Uint16Array.from(source as ArrayLike<number>);
    const output = new Uint16Array(typed.length);
    output.set(typed);
    const height = chunk.shape[chunk.shape.length - 2];
    const width = chunk.shape[chunk.shape.length - 1];
    return {
      ok: true,
      width,
      height,
      data: toArrayBuffer(new Uint8Array(output.buffer)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to load frame." };
  }
}

async function runKillPredictTask(
  request: RunKillPredictRequest,
  sendProgress: (progress: number, message: string) => void,
): Promise<RunKillPredictResponse> {
  const { runKillPredict } = await import("./kill-inference.js");
  const context = await getZarrContext(request.workspacePath);

  const listCrops = async (_workspacePath: string, posId: string): Promise<string[]> => {
    const p = path.join(request.workspacePath, "crops.zarr", "pos", posId, "crop");
    const entries = await readdir(p, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  };

  const getCropShape = async (
    workspacePath: string,
    posId: string,
    cropId: string,
  ): Promise<{ nT: number }> => {
    const arr = await getCachedZarrArray(workspacePath, posId, cropId);
    return { nT: arr.shape[0] };
  };

  const getCropChunk = async (
    workspacePath: string,
    posId: string,
    cropId: string,
    t: number,
    c: number,
    z: number,
  ): Promise<{ data: Uint16Array; height: number; width: number }> => {
    let arr = await getCachedZarrArray(workspacePath, posId, cropId);
    let chunk: ZarrChunk;
    try {
      chunk = await arr.getChunk([t, c, z, 0, 0]);
    } catch {
      context.arrays.delete(`${posId}/${cropId}`);
      arr = await getCachedZarrArray(workspacePath, posId, cropId);
      chunk = await arr.getChunk([t, c, z, 0, 0]);
    }
    const source = chunk.data;
    const typed =
      source instanceof Uint16Array ? source : Uint16Array.from(source as ArrayLike<number>);
    const data = new Uint16Array(typed.length);
    data.set(typed);
    const height = chunk.shape[chunk.shape.length - 2];
    const width = chunk.shape[chunk.shape.length - 1];
    return { data, height, width };
  };

  return runKillPredict({
    ...request,
    getCropChunk,
    getCropShape,
    listCrops,
    sendProgress,
  });
}

async function hasMasks({ masksPath }: HasMasksRequest): Promise<HasMasksResponse> {
  try {
    await access(masksPath, constants.R_OK);
    const posRoot = path.join(masksPath, "pos");
    await access(posRoot, constants.R_OK);
    return { hasMasks: true };
  } catch {
    return { hasMasks: false };
  }
}

async function pickMasksDirectory(): Promise<{ path: string } | null> {
  const result = await dialog.showOpenDialog({
    title: "Select masks zarr folder",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  try {
    await access(chosen, constants.R_OK);
    const posRoot = path.join(chosen, "pos");
    await access(posRoot, constants.R_OK);
  } catch {
    return null;
  }
  return { path: chosen };
}

async function loadMaskFrame({
  masksPath,
  posId,
  cropId,
  t,
}: LoadMaskFrameRequest): Promise<LoadMaskFrameResponse> {
  const key = `${posId}/${cropId}`;
  try {
    const context = await getMasksContext(masksPath);
    let arr = await getCachedMasksArray(masksPath, posId, cropId);
    let chunk: ZarrChunk;
    try {
      chunk = await arr.getChunk([t, 0, 0]);
    } catch {
      context.arrays.delete(key);
      arr = await getCachedMasksArray(masksPath, posId, cropId);
      chunk = await arr.getChunk([t, 0, 0]);
    }

    const source = chunk.data;
    const typed =
      source instanceof Uint32Array ? source : Uint32Array.from(source as ArrayLike<number>);
    const output = new Uint32Array(typed.length);
    output.set(typed);
    const height = chunk.shape[chunk.shape.length - 2];
    const width = chunk.shape[chunk.shape.length - 1];
    return {
      ok: true,
      width,
      height,
      data: toArrayBuffer(new Uint8Array(output.buffer)),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message || "Failed to load mask frame." };
  }
}

async function persistWorkspaceDb(db: Database): Promise<void> {
  const dir = path.dirname(getWorkspaceDbPath());
  const targetPath = getWorkspaceDbPath();
  const tempPath = path.join(dir, `${WORKSPACE_DB_FILENAME}.${process.pid}-${Date.now()}.tmp`);

  await mkdir(dir, { recursive: true });
  await writeFile(tempPath, Buffer.from(db.export()));
  // On Windows, rename() fails with EPERM when target exists; copyFile overwrites reliably.
  await copyFile(tempPath, targetPath);
  await unlink(tempPath);
}

async function ensureWorkspaceDb(): Promise<Database> {
  if (workspaceDb) return workspaceDb;

  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });

  let db: Database;
  try {
    const fileBytes = await readFile(getWorkspaceDbPath());
    db = new SQL.Database(new Uint8Array(fileBytes));
  } catch {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS workspace_state (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      request_json TEXT NOT NULL,
      result_json TEXT,
      error TEXT,
      logs_json TEXT NOT NULL,
      progress_events_json TEXT NOT NULL
    );
  `);

  workspaceDb = db;
  return workspaceDb;
}

async function loadWorkspaceStateFromDb(): Promise<unknown | null> {
  const db = await ensureWorkspaceDb();
  const stmt = db.prepare("SELECT state_json FROM workspace_state WHERE id = ?");
  stmt.bind([WORKSPACE_STATE_KEY]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject() as { state_json?: unknown };
  stmt.free();
  if (typeof row.state_json !== "string") return null;
  try {
    return JSON.parse(row.state_json);
  } catch {
    return null;
  }
}

async function saveWorkspaceStateToDb(payload: unknown): Promise<void> {
  const db = await ensureWorkspaceDb();
  db.run(
    `
    INSERT INTO workspace_state (id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
    `,
    [WORKSPACE_STATE_KEY, JSON.stringify(payload ?? {}), Date.now()],
  );
  await persistWorkspaceDb(db);
}

interface TaskRecord {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  logs: string[];
  progress_events: Array<{ progress: number; message: string; timestamp: string }>;
}

async function insertTask(task: TaskRecord): Promise<void> {
  const db = await ensureWorkspaceDb();
  db.run(
    `INSERT INTO tasks (id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.kind,
      task.status,
      task.created_at,
      task.started_at,
      task.finished_at,
      JSON.stringify(task.request ?? {}),
      task.result != null ? JSON.stringify(task.result) : null,
      task.error,
      JSON.stringify(task.logs ?? []),
      JSON.stringify(task.progress_events ?? []),
    ],
  );
  await persistWorkspaceDb(db);
}

async function updateTask(
  id: string,
  updates: Partial<
    Pick<TaskRecord, "status" | "finished_at" | "error" | "progress_events" | "result">
  >,
): Promise<void> {
  const db = await ensureWorkspaceDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (updates.status != null) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.finished_at != null) {
    sets.push("finished_at = ?");
    values.push(updates.finished_at);
  }
  if (updates.error != null) {
    sets.push("error = ?");
    values.push(updates.error);
  }
  if (updates.result !== undefined) {
    sets.push("result_json = ?");
    values.push(updates.result ? JSON.stringify(updates.result) : null);
  }
  if (updates.progress_events != null) {
    sets.push("progress_events_json = ?");
    values.push(JSON.stringify(updates.progress_events));
  }
  if (sets.length === 0) return;
  values.push(id);
  db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
  await persistWorkspaceDb(db);
}

async function listTasks(): Promise<TaskRecord[]> {
  const db = await ensureWorkspaceDb();
  const stmt = db.prepare(
    "SELECT id, kind, status, created_at, started_at, finished_at, request_json, result_json, error, logs_json, progress_events_json FROM tasks ORDER BY created_at DESC",
  );
  const rows: TaskRecord[] = [];
  while (stmt.step()) {
    const r = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      id: r.id as string,
      kind: r.kind as string,
      status: r.status as string,
      created_at: r.created_at as string,
      started_at: (r.started_at as string) ?? null,
      finished_at: (r.finished_at as string) ?? null,
      request: (() => {
        try {
          return (typeof r.request_json === "string" ? JSON.parse(r.request_json) : {}) as Record<
            string,
            unknown
          >;
        } catch {
          return {};
        }
      })(),
      result: (() => {
        if (r.result_json == null) return null;
        try {
          return (typeof r.result_json === "string" ? JSON.parse(r.result_json) : null) as Record<
            string,
            unknown
          >;
        } catch {
          return null;
        }
      })(),
      error: (r.error as string) ?? null,
      logs: (() => {
        try {
          return (typeof r.logs_json === "string" ? JSON.parse(r.logs_json) : []) as string[];
        } catch {
          return [];
        }
      })(),
      progress_events: (() => {
        try {
          return (
            typeof r.progress_events_json === "string" ? JSON.parse(r.progress_events_json) : []
          ) as TaskRecord["progress_events"];
        } catch {
          return [];
        }
      })(),
    });
  }
  stmt.free();
  return rows;
}

function registerWorkspaceStateIpc(): void {
  ipcMain.handle("workspace-state:load", async () => {
    return loadWorkspaceStateFromDb();
  });

  ipcMain.handle("workspace-state:save", async (_event, payload: unknown) => {
    await saveWorkspaceStateToDb(payload);
    return true;
  });

  ipcMain.handle("workspace:pick-directory", async () => {
    return pickWorkspaceDirectory();
  });

  ipcMain.handle(
    "workspace:rescan-directory",
    async (_event, payload: { path: string }): Promise<WorkspaceScanResult | null> => {
      try {
        await access(payload.path, constants.R_OK);
        return scanWorkspaceDirectory(payload.path);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "workspace:read-position-image",
    async (_event, payload: ReadPositionImageRequest) => {
      return readAndNormalizePositionImage(payload);
    },
  );

  ipcMain.handle("workspace:save-bbox-csv", async (_event, payload: SaveBboxCsvRequest) => {
    return saveBboxCsvToWorkspace(payload);
  });

  ipcMain.handle("workspace:pick-tags-file", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select tags YAML file",
      properties: ["openFile"],
      filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const content = await readFile(result.filePaths[0], "utf-8");
    return content;
  });

  ipcMain.handle("zarr:discover", async (_event, payload: DiscoverZarrRequest) => {
    return discoverZarr(payload);
  });

  ipcMain.handle("zarr:load-frame", async (_event, payload: LoadZarrFrameRequest) => {
    return loadZarrFrame(payload);
  });

  ipcMain.handle("zarr:has-masks", async (_event, payload: HasMasksRequest) => {
    return hasMasks(payload);
  });

  ipcMain.handle("zarr:load-mask-frame", async (_event, payload: LoadMaskFrameRequest) => {
    return loadMaskFrame(payload);
  });

  ipcMain.handle("zarr:pick-masks-dir", async () => {
    return pickMasksDirectory();
  });

  ipcMain.handle("tasks:pick-crops-destination", async () => {
    const result = await dialog.showOpenDialog({
      title: "Select folder for crops.zarr",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: path.join(result.filePaths[0], "crops.zarr") };
  });

  ipcMain.handle("tasks:pick-kill-model", async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select ONNX model directory",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0];
    try {
      await access(path.join(dir, "model.onnx"), constants.R_OK);
    } catch {
      return null;
    }
    return { path: dir };
  });

  ipcMain.handle(
    "tasks:pick-expression-output",
    async (_event, suggestedPath?: string): Promise<{ path: string } | null> => {
      const result = await dialog.showSaveDialog({
        title: "Save expression CSV",
        filters: [{ name: "CSV", extensions: ["csv"] }],
        defaultPath: suggestedPath ?? "expression.csv",
      });
      if (result.canceled || !result.filePath) return null;
      return { path: result.filePath };
    },
  );

  ipcMain.handle("tasks:pick-movie-output", async (): Promise<{ path: string } | null> => {
    const result = await dialog.showSaveDialog({
      title: "Save movie as",
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) return null;
    return { path: result.filePath };
  });

  ipcMain.handle("tasks:pick-spots-file", async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select spots CSV (t,crop,spot,y,x)",
      properties: ["openFile"],
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle("tasks:pick-nd2-input", async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select ND2 file",
      properties: ["openFile"],
      filters: [{ name: "ND2", extensions: ["nd2"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle("tasks:pick-convert-output", async (): Promise<{ path: string } | null> => {
    const result = await dialog.showOpenDialog({
      title: "Select output folder for TIFFs",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle(
    "tasks:has-bbox-csv",
    async (_event, payload: { workspacePath: string; pos: number }): Promise<boolean> => {
      try {
        const bboxPath = path.join(payload.workspacePath, `Pos${payload.pos}_bbox.csv`);
        await access(bboxPath, constants.R_OK);
        return true;
      } catch {
        return false;
      }
    },
  );

  const EXPRESSION_CSV_RE = /^Pos(\d+)_expression\.csv$/i;
  ipcMain.handle(
    "application:list-expression-csv",
    async (_event, workspacePath: string): Promise<Array<{ posId: string; path: string }>> => {
      try {
        const entries = await readdir(workspacePath, { withFileTypes: true });
        const out: Array<{ posId: string; path: string }> = [];
        for (const e of entries) {
          if (!e.isFile()) continue;
          const m = e.name.match(EXPRESSION_CSV_RE);
          if (m) out.push({ posId: m[1], path: path.join(workspacePath, e.name) });
        }
        out.sort((a, b) => a.posId.localeCompare(b.posId, undefined, { numeric: true }));
        return out;
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    "application:load-expression-csv",
    async (
      _event,
      csvPath: string,
    ): Promise<{ ok: true; rows: ExpressionAnalyzeRow[] } | { ok: false; error: string }> => {
      try {
        const rows = await parseExpressionCsv(csvPath);
        return { ok: true, rows };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "tasks:run-movie",
    async (
      event: Electron.IpcMainInvokeEvent,
      payload: RunMovieRequest,
    ): Promise<RunMovieResponse> => {
      const progressEvents: Array<{ progress: number; message: string; timestamp: string }> = [];
      const sendProgress = (progress: number, message: string) => {
        progressEvents.push({
          progress,
          message,
          timestamp: new Date().toISOString(),
        });
        event.sender.send("tasks:movie-progress", {
          taskId: payload.taskId,
          progress,
          message,
        });
        updateTask(payload.taskId, { progress_events: progressEvents }).catch(() => {});
      };
      const ffmpegMod = await import("ffmpeg-static");
      const ffmpegPath =
        typeof ffmpegMod === "object" && ffmpegMod !== null && "default" in ffmpegMod
          ? (ffmpegMod as { default: string | null }).default
          : null;
      if (!ffmpegPath || typeof ffmpegPath !== "string") {
        await updateTask(payload.taskId, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: "ffmpeg binary not found",
          progress_events: progressEvents,
        });
        return { ok: false, error: "ffmpeg binary not found" };
      }
      const args = [
        "movie",
        "--input-zarr",
        payload.input_zarr,
        "--pos",
        String(payload.pos),
        "--crop",
        String(payload.crop),
        "--channel",
        String(payload.channel),
        "--time",
        payload.time,
        "--output",
        payload.output,
        "--fps",
        String(payload.fps),
        "--colormap",
        payload.colormap,
        "--ffmpeg",
        ffmpegPath,
        ...(payload.spots ? ["--spots", payload.spots] : []),
      ];
      const result = await runMupatternSubprocess(args, sendProgress);
      await updateTask(payload.taskId, {
        status: result.ok ? "succeeded" : "failed",
        finished_at: new Date().toISOString(),
        error: result.ok ? null : result.error,
        progress_events: progressEvents,
      });
      return result;
    },
  );

  ipcMain.handle(
    "tasks:run-expression-analyze",
    async (
      event: Electron.IpcMainInvokeEvent,
      payload: RunExpressionAnalyzeRequest,
    ): Promise<RunExpressionAnalyzeResponse> => {
      const progressEvents: Array<{ progress: number; message: string; timestamp: string }> = [];
      const sendProgress = (progress: number, message: string) => {
        progressEvents.push({
          progress,
          message,
          timestamp: new Date().toISOString(),
        });
        event.sender.send("tasks:expression-analyze-progress", {
          taskId: payload.taskId,
          progress,
          message,
        });
        updateTask(payload.taskId, { progress_events: progressEvents }).catch(() => {});
      };
      const args = [
        "expression",
        "--workspace",
        payload.workspacePath,
        "--pos",
        String(payload.pos),
        "--channel",
        String(payload.channel),
        "--output",
        payload.output,
      ];
      const result = await runMupatternSubprocess(args, sendProgress);
      if (!result.ok) {
        await updateTask(payload.taskId, {
          status: "failed",
          finished_at: new Date().toISOString(),
          error: result.error,
          progress_events: progressEvents,
        });
        return result;
      }
      const rows = await parseExpressionCsv(payload.output);
      await updateTask(payload.taskId, {
        status: "succeeded",
        finished_at: new Date().toISOString(),
        error: null,
        result: { output: payload.output, rows },
        progress_events: progressEvents,
      });
      return { ok: true, output: payload.output, rows };
    },
  );

  ipcMain.handle(
    "tasks:run-kill-predict",
    async (
      event: Electron.IpcMainInvokeEvent,
      payload: RunKillPredictRequest,
    ): Promise<RunKillPredictResponse> => {
      const progressEvents: Array<{ progress: number; message: string; timestamp: string }> = [];
      const sendProgress = (progress: number, message: string) => {
        progressEvents.push({
          progress,
          message,
          timestamp: new Date().toISOString(),
        });
        event.sender.send("tasks:kill-predict-progress", {
          taskId: payload.taskId,
          progress,
          message,
        });
        updateTask(payload.taskId, { progress_events: progressEvents }).catch(() => {});
      };
      const result = await runKillPredictTask(payload, sendProgress);
      await updateTask(payload.taskId, {
        status: result.ok ? "succeeded" : "failed",
        finished_at: new Date().toISOString(),
        error: result.ok ? null : result.error,
        result: result.ok ? { output: result.output, rows: result.rows } : undefined,
        progress_events: progressEvents,
      });
      return result;
    },
  );

  ipcMain.handle(
    "tasks:run-crop",
    async (
      event: Electron.IpcMainInvokeEvent,
      payload: RunCropRequest,
    ): Promise<RunCropResponse> => {
      const progressEvents: Array<{ progress: number; message: string; timestamp: string }> = [];
      const sendProgress = (progress: number, message: string) => {
        progressEvents.push({
          progress,
          message,
          timestamp: new Date().toISOString(),
        });
        event.sender.send("tasks:crop-progress", {
          taskId: payload.taskId,
          progress,
          message,
        });
        updateTask(payload.taskId, { progress_events: progressEvents }).catch(() => {});
      };
      const args = [
        "crop",
        "--input",
        payload.input_dir,
        "--pos",
        String(payload.pos),
        "--bbox",
        payload.bbox,
        "--output",
        payload.output,
        ...(payload.background ? ["--background"] : []),
      ];
      const result = await runMupatternSubprocess(args, sendProgress);
      await updateTask(payload.taskId, {
        status: result.ok ? "succeeded" : "failed",
        finished_at: new Date().toISOString(),
        error: result.ok ? null : result.error,
        progress_events: progressEvents,
      });
      return result;
    },
  );

  ipcMain.handle(
    "tasks:run-convert",
    async (
      event: Electron.IpcMainInvokeEvent,
      payload: RunConvertRequest,
    ): Promise<RunConvertResponse> => {
      const progressEvents: Array<{ progress: number; message: string; timestamp: string }> = [];
      const sendProgress = (progress: number, message: string) => {
        progressEvents.push({
          progress,
          message,
          timestamp: new Date().toISOString(),
        });
        event.sender.send("tasks:convert-progress", {
          taskId: payload.taskId,
          progress,
          message,
        });
        updateTask(payload.taskId, { progress_events: progressEvents }).catch(() => {});
      };
      const args = [
        "convert",
        "--input",
        payload.input,
        "--pos",
        payload.pos,
        "--time",
        payload.time,
        "--output",
        payload.output,
        "--yes",
      ];
      const result = await runMupatternSubprocess(args, sendProgress);
      await updateTask(payload.taskId, {
        status: result.ok ? "succeeded" : "failed",
        finished_at: new Date().toISOString(),
        error: result.ok ? null : result.error,
        progress_events: progressEvents,
      });
      return result;
    },
  );

  ipcMain.handle("tasks:insert-task", async (_event, task: TaskRecord) => {
    await insertTask(task);
    return true;
  });

  ipcMain.handle(
    "tasks:update-task",
    async (
      _event,
      id: string,
      updates: Partial<
        Pick<TaskRecord, "status" | "finished_at" | "error" | "progress_events" | "result">
      >,
    ) => {
      await updateTask(id, updates);
      return true;
    },
  );

  ipcMain.handle("tasks:list-tasks", async () => {
    return listTasks();
  });

  ipcMain.handle("tasks:delete-completed-tasks", async () => {
    const db = await ensureWorkspaceDb();
    db.run("DELETE FROM tasks WHERE status NOT IN ('running', 'queued')");
    await persistWorkspaceDb(db);
    return true;
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
    return;
  }

  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  registerWorkspaceStateIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (workspaceDb) {
    workspaceDb.close();
    workspaceDb = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
