export interface LoadedImage {
  img: HTMLImageElement
  baseName: string
  width: number
  height: number
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "")
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode image"))
        return
      }
      resolve(URL.createObjectURL(blob))
    }, "image/png")
  })
}

interface WorkerDecodeResult {
  width: number
  height: number
  rgba: ArrayBuffer
}

interface DecodeSuccessMessage {
  id: number
  ok: true
  width: number
  height: number
  rgba: ArrayBuffer
}

interface DecodeFailureMessage {
  id: number
  ok: false
  error: string
}

type DecodeMessage = DecodeSuccessMessage | DecodeFailureMessage

let decodeWorker: Worker | null = null
let nextDecodeId = 1
const pendingDecodes = new Map<
  number,
  { resolve: (value: WorkerDecodeResult) => void; reject: (reason?: unknown) => void }
>()

function getDecodeWorker(): Worker {
  if (decodeWorker) return decodeWorker
  decodeWorker = new Worker(new URL("./tiff-decode.worker.ts", import.meta.url), { type: "module" })
  decodeWorker.onmessage = (event: MessageEvent<DecodeMessage>) => {
    const message = event.data
    const pending = pendingDecodes.get(message.id)
    if (!pending) return
    pendingDecodes.delete(message.id)

    if (!message.ok) {
      pending.reject(new Error(message.error))
      return
    }

    pending.resolve({
      width: message.width,
      height: message.height,
      rgba: message.rgba,
    })
  }
  decodeWorker.onerror = (event) => {
    for (const pending of pendingDecodes.values()) {
      pending.reject(new Error(event.message || "TIFF decode worker failed"))
    }
    pendingDecodes.clear()
  }
  return decodeWorker
}

function decodeTiffInWorker(buffer: ArrayBuffer): Promise<WorkerDecodeResult> {
  return new Promise((resolve, reject) => {
    const id = nextDecodeId++
    pendingDecodes.set(id, { resolve, reject })
    const worker = getDecodeWorker()
    worker.postMessage({ id, buffer }, [buffer])
  })
}

/**
 * Decode a TIF/TIFF file into an HTMLImageElement.
 * Returns a promise that resolves with the decoded image info.
 */
export async function loadTifFromFile(file: File): Promise<LoadedImage> {
  const baseName = stripExtension(file.name)
  const buffer = await file.arrayBuffer()
  const { rgba, width, height } = await decodeTiffInWorker(buffer)
  const pixels = new Uint8ClampedArray(rgba)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!
  const imageData = new ImageData(pixels, width, height)
  ctx.putImageData(imageData, 0, 0)

  const objectUrl = await canvasToObjectUrl(canvas)

  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ img, baseName, width, height })
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Failed to create image from decoded TIFF"))
    }
    img.src = objectUrl
  })
}

/**
 * Load a PNG file into an HTMLImageElement.
 */
export function loadPngFromFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const baseName = stripExtension(file.name)
    const reader = new FileReader()

    reader.onerror = () => reject(new Error("Failed to read file"))

    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => resolve({ img, baseName, width: img.width, height: img.height })
      img.onerror = () => reject(new Error("Failed to load PNG"))
      img.src = e.target?.result as string
    }

    reader.readAsDataURL(file)
  })
}

/**
 * Load any supported image file (TIF/TIFF/PNG).
 */
export function loadImageFile(file: File): Promise<LoadedImage> {
  const isTiff = /\.tiff?$/i.test(file.name) || file.type === "image/tiff" || file.type === "image/tif"
  return isTiff ? loadTifFromFile(file) : loadPngFromFile(file)
}
