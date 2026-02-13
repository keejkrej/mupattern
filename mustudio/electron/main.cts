import { app, BrowserWindow, dialog, ipcMain } from "electron"
import path from "node:path"
import { access, constants, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import initSqlJs, { type Database } from "sql.js"
import * as UTIF from "utif2"
import type { Array as ZarritaArray, DataType, Location } from "zarrita"
import type { Readable } from "@zarrita/storage"
import type FileSystemStore from "@zarrita/storage/fs"

const DEV_SERVER_URL = "http://localhost:5173"
const WORKSPACE_DB_FILENAME = "mustudio.sqlite"
const WORKSPACE_STATE_KEY = "workspace-state"
const TIFF_RE = /^img_channel(\d+)_position(\d+)_time(\d+)_z(\d+)\.tif$/i

interface WorkspaceScanResult {
  path: string
  name: string
  positions: number[]
  channels: number[]
  times: number[]
  zSlices: number[]
}

interface ReadPositionImageRequest {
  workspacePath: string
  pos: number
  channel: number
  time: number
  z: number
}

interface ReadPositionImageSuccess {
  ok: true
  baseName: string
  width: number
  height: number
  rgba: ArrayBuffer
}

interface ReadPositionImageFailure {
  ok: false
  error: string
}

type ReadPositionImageResponse = ReadPositionImageSuccess | ReadPositionImageFailure

interface SaveBboxCsvRequest {
  workspacePath: string
  pos: number
  csv: string
}

interface DiscoverZarrRequest {
  workspacePath: string
  positionFilter?: string[]
  metadataMode?: "full" | "fast"
}

interface DiscoverZarrResponse {
  positions: string[]
  crops: Record<string, Array<{ posId: string; cropId: string; shape: number[] }>>
}

interface LoadZarrFrameRequest {
  workspacePath: string
  posId: string
  cropId: string
  t: number
  c: number
  z: number
}

interface LoadZarrFrameSuccess {
  ok: true
  width: number
  height: number
  data: ArrayBuffer
}

interface LoadZarrFrameFailure {
  ok: false
  error: string
}

type LoadZarrFrameResponse = LoadZarrFrameSuccess | LoadZarrFrameFailure

type ZarrArrayHandle = ZarritaArray<DataType, Readable>
type ZarrChunk = Awaited<ReturnType<ZarrArrayHandle["getChunk"]>>
type ZarrLocation = Location<Readable>

interface ZarrContext {
  root: ZarrLocation
  arrays: Map<string, Promise<ZarrArrayHandle>>
}

let workspaceDb: Database | null = null
let zarrModulePromise: Promise<typeof import("zarrita")> | null = null
let fsStoreCtorPromise: Promise<typeof FileSystemStore> | null = null
const zarrContextByWorkspacePath = new Map<string, ZarrContext>()

function getWorkspaceDbPath(): string {
  return path.join(app.getPath("userData"), WORKSPACE_DB_FILENAME)
}

function posDirName(pos: number): string {
  return `Pos${pos}`
}

/** Format: img_channel{C:03d}_position{P:03d}_time{T:09d}_z{Z:03d}.tif */
function buildTifFilename(pos: number, channel: number, time: number, z: number): string {
  return `img_channel${String(channel).padStart(3, "0")}_position${String(pos).padStart(3, "0")}_time${String(time).padStart(9, "0")}_z${String(z).padStart(3, "0")}.tif`
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

function normalizeRgbaInPlace(rgba: Uint8Array, width: number, height: number): void {
  const n = width * height
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (let i = 0; i < n; i += 1) {
    const j = i * 4
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
    if (lum < min) min = lum
    if (lum > max) max = lum
  }

  if (max <= min) return

  const scale = 255 / (max - min)
  for (let i = 0; i < n; i += 1) {
    const j = i * 4
    const lum = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]
    const newLum = (lum - min) * scale
    const factor = lum > 0 ? newLum / lum : 0
    rgba[j] = Math.max(0, Math.min(255, Math.round(rgba[j] * factor)))
    rgba[j + 1] = Math.max(0, Math.min(255, Math.round(rgba[j + 1] * factor)))
    rgba[j + 2] = Math.max(0, Math.min(255, Math.round(rgba[j + 2] * factor)))
  }
}

function parsePosDirName(name: string): number | null {
  const match = name.match(/^Pos(\d+)$/i)
  return match ? Number.parseInt(match[1], 10) : null
}

async function scanWorkspaceDirectory(workspacePath: string): Promise<WorkspaceScanResult | null> {
  const entries = await readdir(workspacePath, { withFileTypes: true })
  const positions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parsePosDirName(entry.name))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)

  if (positions.length === 0) return null

  const channels = new Set<number>()
  const times = new Set<number>()
  const zSlices = new Set<number>()
  const firstPosPath = path.join(workspacePath, posDirName(positions[0]))
  const firstPosEntries = await readdir(firstPosPath, { withFileTypes: true })
  for (const entry of firstPosEntries) {
    if (!entry.isFile()) continue
    const match = entry.name.match(TIFF_RE)
    if (!match) continue
    channels.add(Number.parseInt(match[1], 10))
    times.add(Number.parseInt(match[3], 10))
    zSlices.add(Number.parseInt(match[4], 10))
  }

  return {
    path: workspacePath,
    name: path.basename(workspacePath),
    positions,
    channels: [...channels].sort((a, b) => a - b),
    times: [...times].sort((a, b) => a - b),
    zSlices: [...zSlices].sort((a, b) => a - b),
  }
}

async function pickWorkspaceDirectory(): Promise<WorkspaceScanResult | null> {
  const result = await dialog.showOpenDialog({
    title: "Select workspace folder",
    properties: ["openDirectory"],
  })
  if (result.canceled || result.filePaths.length === 0) return null

  const workspacePath = result.filePaths[0]
  await access(workspacePath, constants.R_OK)
  return scanWorkspaceDirectory(workspacePath)
}

async function readAndNormalizePositionImage(
  request: ReadPositionImageRequest
): Promise<ReadPositionImageResponse> {
  try {
    const filename = buildTifFilename(request.pos, request.channel, request.time, request.z)
    const filePath = path.join(request.workspacePath, posDirName(request.pos), filename)
    const fileBytes = await readFile(filePath)
    const buffer = toArrayBuffer(fileBytes)
    const ifds = UTIF.decode(buffer)
    if (ifds.length === 0) {
      return { ok: false, error: "Could not decode TIFF file." }
    }

    UTIF.decodeImage(buffer, ifds[0])
    const rgba = UTIF.toRGBA8(ifds[0])
    const width = ifds[0].width
    const height = ifds[0].height
    normalizeRgbaInPlace(rgba, width, height)

    const rgbaCopy = new Uint8Array(rgba.length)
    rgbaCopy.set(rgba)

    return {
      ok: true,
      baseName: path.parse(filename).name,
      width,
      height,
      rgba: toArrayBuffer(rgbaCopy),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message || "Failed to load workspace image." }
  }
}

async function saveBboxCsvToWorkspace({ workspacePath, pos, csv }: SaveBboxCsvRequest): Promise<boolean> {
  const filePath = path.join(workspacePath, `${posDirName(pos)}_bbox.csv`)
  await writeFile(filePath, csv, "utf8")
  return true
}

async function getZarrDeps(): Promise<{
  zarr: typeof import("zarrita")
  FileSystemStore: typeof FileSystemStore
}> {
  if (!zarrModulePromise) {
    zarrModulePromise = import("zarrita")
  }
  if (!fsStoreCtorPromise) {
    fsStoreCtorPromise = import("@zarrita/storage/fs").then((module) => module.default)
  }
  return {
    zarr: await zarrModulePromise,
    FileSystemStore: await fsStoreCtorPromise,
  }
}

async function getZarrContext(workspacePath: string): Promise<ZarrContext> {
  const existing = zarrContextByWorkspacePath.get(workspacePath)
  if (existing) return existing

  const { zarr, FileSystemStore } = await getZarrDeps()
  const zarrPath = path.join(workspacePath, "crops.zarr")
  const store = new FileSystemStore(zarrPath)
  const root: ZarrLocation = zarr.root(store)
  const context: ZarrContext = { root, arrays: new Map() }
  zarrContextByWorkspacePath.set(workspacePath, context)
  return context
}

async function getCachedZarrArray(
  workspacePath: string,
  posId: string,
  cropId: string
): Promise<ZarrArrayHandle> {
  const context = await getZarrContext(workspacePath)
  const key = `${posId}/${cropId}`
  let promise = context.arrays.get(key)
  if (!promise) {
    const { zarr } = await getZarrDeps()
    promise = zarr.open(context.root.resolve(`pos/${posId}/crop/${cropId}`), { kind: "array" })
    promise.catch(() => {
      const current = context.arrays.get(key)
      if (current === promise) context.arrays.delete(key)
    })
    context.arrays.set(key, promise)
  }
  return promise
}

async function readShapeFromZarrayFile(cropPath: string): Promise<number[] | null> {
  try {
    const text = await readFile(path.join(cropPath, ".zarray"), "utf8")
    const parsed = JSON.parse(text) as { shape?: unknown }
    if (!Array.isArray(parsed.shape)) return null
    const shape = parsed.shape.filter((value): value is number => typeof value === "number")
    return shape.length >= 5 ? shape : null
  } catch {
    return null
  }
}

async function discoverZarr({
  workspacePath,
  positionFilter,
  metadataMode = "full",
}: DiscoverZarrRequest): Promise<DiscoverZarrResponse> {
  const response: DiscoverZarrResponse = { positions: [], crops: {} }
  const posRoot = path.join(workspacePath, "crops.zarr", "pos")

  let discoveredPosIds: string[]
  if (positionFilter && positionFilter.length > 0) {
    discoveredPosIds = positionFilter
  } else {
    try {
      const entries = await readdir(posRoot, { withFileTypes: true })
      discoveredPosIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch {
      return response
    }
  }

  for (const posId of discoveredPosIds) {
    const cropRoot = path.join(posRoot, posId, "crop")
    let cropIds: string[]
    try {
      const entries = await readdir(cropRoot, { withFileTypes: true })
      cropIds = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch {
      continue
    }

    if (cropIds.length === 0) continue

    response.positions.push(posId)
    const infos: Array<{ posId: string; cropId: string; shape: number[] }> = []
    if (metadataMode === "fast") {
      const firstShape = (await readShapeFromZarrayFile(path.join(cropRoot, cropIds[0]))) ?? [1, 1, 1, 1, 1]
      for (const cropId of cropIds) {
        infos.push({ posId, cropId, shape: firstShape })
      }
    } else {
      for (const cropId of cropIds) {
        try {
          const arr = await getCachedZarrArray(workspacePath, posId, cropId)
          infos.push({ posId, cropId, shape: [...arr.shape] })
        } catch {
          // skip crop if it can't be opened
        }
      }
    }
    response.crops[posId] = infos
  }

  return response
}

async function loadZarrFrame({
  workspacePath,
  posId,
  cropId,
  t,
  c,
  z,
}: LoadZarrFrameRequest): Promise<LoadZarrFrameResponse> {
  const key = `${posId}/${cropId}`
  try {
    const context = await getZarrContext(workspacePath)
    let arr = await getCachedZarrArray(workspacePath, posId, cropId)
    let chunk: ZarrChunk
    try {
      chunk = await arr.getChunk([t, c, z, 0, 0])
    } catch {
      context.arrays.delete(key)
      arr = await getCachedZarrArray(workspacePath, posId, cropId)
      chunk = await arr.getChunk([t, c, z, 0, 0])
    }

    const source = chunk.data
    const typed =
      source instanceof Uint16Array
        ? source
        : Uint16Array.from(source as ArrayLike<number>)
    const output = new Uint16Array(typed.length)
    output.set(typed)
    const height = chunk.shape[chunk.shape.length - 2]
    const width = chunk.shape[chunk.shape.length - 1]
    return {
      ok: true,
      width,
      height,
      data: toArrayBuffer(new Uint8Array(output.buffer)),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message || "Failed to load frame." }
  }
}

async function persistWorkspaceDb(db: Database): Promise<void> {
  const dir = app.getPath("userData")
  const targetPath = getWorkspaceDbPath()
  const tempPath = `${targetPath}.tmp`

  await mkdir(dir, { recursive: true })
  await writeFile(tempPath, Buffer.from(db.export()))
  await rename(tempPath, targetPath)
}

async function ensureWorkspaceDb(): Promise<Database> {
  if (workspaceDb) return workspaceDb

  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  })

  let db: Database
  try {
    const fileBytes = await readFile(getWorkspaceDbPath())
    db = new SQL.Database(new Uint8Array(fileBytes))
  } catch {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS workspace_state (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  workspaceDb = db
  return workspaceDb
}

async function loadWorkspaceStateFromDb(): Promise<unknown | null> {
  const db = await ensureWorkspaceDb()
  const stmt = db.prepare("SELECT state_json FROM workspace_state WHERE id = ?")
  stmt.bind([WORKSPACE_STATE_KEY])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as { state_json?: unknown }
  stmt.free()
  if (typeof row.state_json !== "string") return null
  try {
    return JSON.parse(row.state_json)
  } catch {
    return null
  }
}

async function saveWorkspaceStateToDb(payload: unknown): Promise<void> {
  const db = await ensureWorkspaceDb()
  db.run(
    `
    INSERT INTO workspace_state (id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
    `,
    [WORKSPACE_STATE_KEY, JSON.stringify(payload ?? {}), Date.now()],
  )
  await persistWorkspaceDb(db)
}

function registerWorkspaceStateIpc(): void {
  ipcMain.handle("workspace-state:load", async () => {
    return loadWorkspaceStateFromDb()
  })

  ipcMain.handle("workspace-state:save", async (_event, payload: unknown) => {
    await saveWorkspaceStateToDb(payload)
    return true
  })

  ipcMain.handle("workspace:pick-directory", async () => {
    return pickWorkspaceDirectory()
  })

  ipcMain.handle("workspace:read-position-image", async (_event, payload: ReadPositionImageRequest) => {
    return readAndNormalizePositionImage(payload)
  })

  ipcMain.handle("workspace:save-bbox-csv", async (_event, payload: SaveBboxCsvRequest) => {
    return saveBboxCsvToWorkspace(payload)
  })

  ipcMain.handle("zarr:discover", async (_event, payload: DiscoverZarrRequest) => {
    return discoverZarr(payload)
  })

  ipcMain.handle("zarr:load-frame", async (_event, payload: LoadZarrFrameRequest) => {
    return loadZarrFrame(payload)
  })
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
  })

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: "detach" })
    return
  }

  win.loadFile(path.join(__dirname, "..", "dist", "index.html"))
}

app.whenReady().then(() => {
  registerWorkspaceStateIpc()
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (workspaceDb) {
    workspaceDb.close()
    workspaceDb = null
  }
  if (process.platform !== "darwin") {
    app.quit()
  }
})
