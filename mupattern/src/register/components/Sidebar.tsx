import { useCallback, useRef } from "react"
import { ChevronsUpDown, ImageIcon, FileText } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { CalibrationControls } from "@/register/components/CalibrationControls"
import { PatternEditor } from "@/register/components/PatternEditor"
import { TransformEditor } from "@/register/components/TransformEditor"
import { ExportButton } from "@/register/components/ExportButton"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { parseYAMLConfig } from "@/register/lib/units"
import * as UTIF from "utif2"
import type { Calibration, Lattice, PatternConfigUm, Transform } from "@/register/types"

const ACCEPTED_TYPES = new Set(["image/png", "image/tiff", "image/tif"])
const TIFF_TYPES = new Set(["image/tiff", "image/tif"])

function isTiff(file: File): boolean {
  return TIFF_TYPES.has(file.type) || /\.tiff?$/i.test(file.name)
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "")
}

interface SidebarProps {
  imageBaseName: string | null
  onImageLoad: (img: HTMLImageElement, filename: string) => void
  onConfigLoad: (config: PatternConfigUm) => void
  onCalibrationLoad: (cal: Calibration) => void
  calibration: Calibration
  onCalibrationChange: (cal: Calibration) => void
  pattern: PatternConfigUm
  onLatticeUpdate: (updates: Partial<Lattice>) => void
  onWidthUpdate: (width: number) => void
  onHeightUpdate: (height: number) => void
  transform: Transform
  onTransformUpdate: (updates: Partial<Transform>) => void
  sensitivity: number
  onSensitivityChange: (v: number) => void
  onReset: () => void
  onExport: () => void
  hasImage: boolean
  hasDetectedPoints: boolean
  onDetect: () => void
  onFitGrid: (basisAngle: number) => void
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between py-1.5 text-base font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors">
          {title}
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function Sidebar({
  imageBaseName,
  onImageLoad,
  onConfigLoad,
  onCalibrationLoad,
  calibration,
  onCalibrationChange,
  pattern,
  onLatticeUpdate,
  onWidthUpdate,
  onHeightUpdate,
  transform,
  onTransformUpdate,
  sensitivity,
  onSensitivityChange,
  onReset,
  onExport,
  hasImage,
  hasDetectedPoints,
  onDetect,
  onFitGrid,
}: SidebarProps) {
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
    <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-border p-4 space-y-1">
      <Section title="Files">
        <div className="space-y-1.5">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/tiff,.tif,.tiff"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = "" }}
            className="hidden"
          />
          <Button variant="secondary" size="sm" className="w-full h-7 text-base" onClick={() => imageInputRef.current?.click()}>
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
          <Button variant="secondary" size="sm" className="w-full h-7 text-base" onClick={() => configInputRef.current?.click()}>
            <FileText className="size-3.5" />
            Load config
          </Button>
        </div>
      </Section>

      <Separator />

      <Section title="Calibration">
        <div className="space-y-3">
          <CalibrationControls
            calibration={calibration}
            onChange={onCalibrationChange}
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-base">Drag sensitivity</Label>
              <span className="text-base text-muted-foreground">
                {sensitivity < 0.3 ? "Fine" : sensitivity > 0.7 ? "Coarse" : "Normal"}
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={[sensitivity]}
              onValueChange={([v]) => onSensitivityChange(v)}
            />
          </div>
        </div>
      </Section>

      <Separator />

      <Section title="Pattern">
        <PatternEditor
          pattern={pattern}
          onLatticeUpdate={onLatticeUpdate}
          onWidthUpdate={onWidthUpdate}
          onHeightUpdate={onHeightUpdate}
        />
      </Section>

      <Separator />

      <Section title="Transform">
        <TransformEditor
          transform={transform}
          onUpdate={onTransformUpdate}
        />
      </Section>

      <Separator />

      <div className="space-y-2 pt-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full h-7 text-base"
          disabled={!hasImage}
          onClick={onDetect}
        >
          Detect cells
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full h-7 text-base"
          disabled={!hasDetectedPoints}
          onClick={() => onFitGrid(Math.PI / 2)}
        >
          Auto square (a=b)
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="w-full h-7 text-base"
          disabled={!hasDetectedPoints}
          onClick={() => onFitGrid(Math.PI / 3)}
        >
          Auto hex (a=b)
        </Button>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" className="flex-1 h-7 text-base" onClick={onReset}>
            Reset
          </Button>
          <ExportButton onExport={onExport} />
        </div>
      </div>

    </aside>
  )
}
