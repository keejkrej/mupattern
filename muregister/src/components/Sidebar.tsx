import { ChevronsUpDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@mupattern/ui/components/ui/collapsible"
import { Separator } from "@mupattern/ui/components/ui/separator"
import { Button } from "@mupattern/ui/components/ui/button"
import { CalibrationControls } from "@/components/CalibrationControls"
import { PatternEditor } from "@/components/PatternEditor"
import { TransformEditor } from "@/components/TransformEditor"
import { ExportButton } from "@/components/ExportButton"
import { Slider } from "@mupattern/ui/components/ui/slider"
import { Label } from "@mupattern/ui/components/ui/label"
import type { Calibration, Lattice, PatternConfigUm, Transform } from "@/types"

interface SidebarProps {
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
  return (
    <aside className="w-80 flex-shrink-0 overflow-y-auto border-l border-border p-4 space-y-1">
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
