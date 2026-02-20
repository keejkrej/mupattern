/**
 * Shared logic for loading PNG/TIFF images. Used by root Landing and Register Landing.
 */

import * as UTIF from "utif2"

const ACCEPTED_TYPES = new Set(["image/png", "image/tiff", "image/tif"])
const TIFF_TYPES = new Set(["image/tiff", "image/tif"])

function isTiff(file: File): boolean {
  return TIFF_TYPES.has(file.type) || /\.tiff?$/i.test(file.name)
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "")
}

export function isAcceptedImageType(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type)
}

export async function loadImageFile(file: File): Promise<{
  image: HTMLImageElement
  filename: string
}> {
  const filename = stripExtension(file.name)

  if (isTiff(file)) {
    const buffer = await file.arrayBuffer()
    const ifds = UTIF.decode(buffer)
    if (ifds.length === 0) {
      throw new Error("Could not decode TIFF file")
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

    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ image: img, filename })
      img.onerror = () => reject(new Error("Failed to decode TIFF"))
      img.src = canvas.toDataURL("image/png")
    })
  }

  if (ACCEPTED_TYPES.has(file.type)) {
    const dataURL = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ image: img, filename })
      img.onerror = () => reject(new Error("Failed to load image"))
      img.src = dataURL
    })
  }

  throw new Error("Only PNG and TIFF files are accepted")
}

export function imageToDataURL(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(img, 0, 0)
  return canvas.toDataURL("image/png")
}
