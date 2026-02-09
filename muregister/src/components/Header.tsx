import { useCallback, useRef } from "react"
import { ThemeToggle } from "@/components/ThemeToggle"
import { Button } from "@mupattern/ui/components/ui/button"
import { ImageIcon, FileText } from "lucide-react"
import { parseYAMLConfig } from "@/lib/units"
import * as UTIF from "utif2"
import type { PatternConfigUm, Calibration } from "@/types"

const ACCEPTED_TYPES = new Set(["image/png", "image/tiff", "image/tif"])
const TIFF_TYPES = new Set(["image/tiff", "image/tif"])

function isTiff(file: File): boolean {
  return TIFF_TYPES.has(file.type) || /\.tiff?$/i.test(file.name)
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "")
}

interface HeaderProps {
  imageBaseName: string | null
  onImageLoad: (img: HTMLImageElement, filename: string) => void
  onConfigLoad: (config: PatternConfigUm) => void
  onCalibrationLoad: (cal: Calibration) => void
}

export function Header({ imageBaseName, onImageLoad, onConfigLoad, onCalibrationLoad }: HeaderProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const configInputRef = useRef<HTMLInputElement>(null)

  const handleImageFile = useCallback((file: File) => {
    const baseName = stripExtension(file.name)

    if (isTiff(file)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer
          const ifds = UTIF.decode(buffer)
          if (ifds.length === 0) return
          UTIF.decodeImage(buffer, ifds[0])
          const rgba = UTIF.toRGBA8(ifds[0])
          const w = ifds[0].width
          const h = ifds[0].height

          const canvas = document.createElement("canvas")
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext("2d")!
          const imageData = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), w, h)
          ctx.putImageData(imageData, 0, 0)

          const img = new Image()
          img.onload = () => onImageLoad(img, baseName)
          img.src = canvas.toDataURL("image/png")
        } catch {
          // silently fail
        }
      }
      reader.readAsArrayBuffer(file)
    } else if (ACCEPTED_TYPES.has(file.type)) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => onImageLoad(img, baseName)
        img.src = e.target?.result as string
      }
      reader.readAsDataURL(file)
    }
  }, [onImageLoad])

  const handleConfigFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const { pattern, calibration } = parseYAMLConfig(text)
        onConfigLoad(pattern)
        if (calibration) onCalibrationLoad(calibration)
      } catch {
        // silently fail
      }
    }
    reader.readAsText(file)
  }, [onConfigLoad, onCalibrationLoad])

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border">
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>MuRegister</h1>
          <p className="text-base text-muted-foreground">
            Microscopy pattern-to-image registration
          </p>
        </div>
        <div className="mx-1 h-8 w-px bg-border" />
        <div className="flex items-center gap-2">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/tiff,.tif,.tiff"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = "" }}
            className="hidden"
          />
          <Button variant="ghost" size="sm" onClick={() => imageInputRef.current?.click()}>
            <ImageIcon className="size-3.5" />
            {imageBaseName ? `${imageBaseName}` : "Load image"}
          </Button>
          <input
            ref={configInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleConfigFile(f); e.target.value = "" }}
            className="hidden"
          />
          <Button variant="ghost" size="sm" onClick={() => configInputRef.current?.click()}>
            <FileText className="size-3.5" />
            Load config
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <p className="text-base text-muted-foreground">
          Drag: pan | Middle-drag: resize | Right-drag: rotate
        </p>
        <ThemeToggle />
      </div>
    </header>
  )
}
