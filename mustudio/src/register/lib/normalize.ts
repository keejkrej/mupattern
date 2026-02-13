/**
 * Normalize ImageData for display using min-max stretch on luminance.
 * Preserves color by scaling R,G,B proportionally so perceived brightness maps to full range.
 * Mutates data in place.
 */
export function normalizeImageDataForDisplay(data: ImageData): void {
  const { data: d, width, height } = data
  const n = width * height

  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const j = i * 4
    const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
    if (lum < min) min = lum
    if (lum > max) max = lum
  }

  if (max <= min) return

  const scale = 255 / (max - min)
  for (let i = 0; i < n; i++) {
    const j = i * 4
    const lum = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]
    const newLum = (lum - min) * scale
    const factor = lum > 0 ? newLum / lum : 0
    d[j] = Math.min(255, d[j] * factor)
    d[j + 1] = Math.min(255, d[j + 1] * factor)
    d[j + 2] = Math.min(255, d[j + 2] * factor)
  }
}

interface NormalizeSuccessMessage {
  id: number
  ok: true
  rgba: ArrayBuffer
}

interface NormalizeFailureMessage {
  id: number
  ok: false
  error: string
}

type NormalizeMessage = NormalizeSuccessMessage | NormalizeFailureMessage

let normalizeWorker: Worker | null = null
let nextNormalizeId = 1
const pendingNormalizations = new Map<
  number,
  { resolve: (value: ImageData) => void; reject: (reason?: unknown) => void; width: number; height: number }
>()

function getNormalizeWorker(): Worker {
  if (normalizeWorker) return normalizeWorker

  normalizeWorker = new Worker(new URL("./normalize.worker.ts", import.meta.url), { type: "module" })
  normalizeWorker.onmessage = (event: MessageEvent<NormalizeMessage>) => {
    const message = event.data
    const pending = pendingNormalizations.get(message.id)
    if (!pending) return
    pendingNormalizations.delete(message.id)

    if (!message.ok) {
      pending.reject(new Error(message.error))
      return
    }

    const out = new Uint8ClampedArray(message.rgba)
    pending.resolve(new ImageData(out, pending.width, pending.height))
  }

  normalizeWorker.onerror = (event) => {
    for (const pending of pendingNormalizations.values()) {
      pending.reject(new Error(event.message || "Normalization worker failed"))
    }
    pendingNormalizations.clear()
  }

  return normalizeWorker
}

export function normalizeImageDataForDisplayAsync(data: ImageData): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const id = nextNormalizeId++
    const payload = new Uint8ClampedArray(data.data.length)
    payload.set(data.data)
    pendingNormalizations.set(id, {
      resolve,
      reject,
      width: data.width,
      height: data.height,
    })
    const worker = getNormalizeWorker()
    worker.postMessage(
      { id, width: data.width, height: data.height, rgba: payload.buffer as ArrayBuffer },
      [payload.buffer as ArrayBuffer],
    )
  })
}
