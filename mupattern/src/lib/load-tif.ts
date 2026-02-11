import * as UTIF from "utif2"

export interface LoadedImage {
  img: HTMLImageElement
  baseName: string
  width: number
  height: number
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "")
}

/**
 * Decode a TIF/TIFF file into an HTMLImageElement.
 * Returns a promise that resolves with the decoded image info.
 */
export function loadTifFromFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const baseName = stripExtension(file.name)
    const reader = new FileReader()

    reader.onerror = () => reject(new Error("Failed to read file"))

    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer
        const ifds = UTIF.decode(buffer)
        if (ifds.length === 0) {
          reject(new Error("Could not decode TIFF file"))
          return
        }
        UTIF.decodeImage(buffer, ifds[0])
        const rgba = UTIF.toRGBA8(ifds[0])
        const w = ifds[0].width
        const h = ifds[0].height

        const canvas = document.createElement("canvas")
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")!
        const imageData = new ImageData(
          new Uint8ClampedArray(rgba.buffer as ArrayBuffer),
          w,
          h
        )
        ctx.putImageData(imageData, 0, 0)

        const img = new Image()
        img.onload = () => resolve({ img, baseName, width: w, height: h })
        img.onerror = () => reject(new Error("Failed to create image from decoded TIFF"))
        img.src = canvas.toDataURL("image/png")
      } catch {
        reject(new Error("Failed to decode TIFF file"))
      }
    }

    reader.readAsArrayBuffer(file)
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
