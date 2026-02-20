import { useCallback, useRef } from "react"
import { ChevronsUpDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { CalibrationControls } from "@/register/components/CalibrationControls"
import { PatternEditor } from "@/register/components/PatternEditor"
import { TransformEditor } from "@/register/components/TransformEditor"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { parseYAMLConfig } from "@/register/lib/units"
import type { Calibration, Lattice, PatternConfigUm, Transform } from "@/register/types"

interface SidebarProps {
  onConfigLoad: (config: PatternConfigUm) => void
  onConfigSave?: () => void
  onCalibrationLoad: (cal: Calibration) => void
  calibration: Calibration
  onCalibrationChange: (cal: Calibration) => void
  pattern: PatternConfigUm
  onLatticeUpdate: (updates: Partial<Lattice>) => void
  onWidthUpdate: (width: number) => void
  onHeightUpdate: (height: number) => void
  transform: Transform
  onTransformUpdate: (updates: Partial<Transform>) => void
  patternOpacity: number
  onPatternOpacityChange: (v: number) => void
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
  onConfigLoad,
  onConfigSave,
  onCalibrationLoad,
  calibration,
  onCalibrationChange,
  pattern,
  onLatticeUpdate,
  onWidthUpdate,
  onHeightUpdate,
  transform,
  onTransformUpdate,
  patternOpacity,
  onPatternOpacityChange,
}: SidebarProps) {
  const configInputRef = useRef<HTMLInputElement>(null)

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
      <Section title="Config">
        <div className="space-y-1.5">
          <input
            ref={configInputRef}
            type="file"
            accept=".yaml,.yml"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleConfigFile(f); e.target.value = "" }}
            className="hidden"
          />
          <Button variant="secondary" size="sm" className="w-full h-7 text-base" onClick={() => configInputRef.current?.click()}>
            Load config
          </Button>
          {onConfigSave && (
            <Button variant="secondary" size="sm" className="w-full h-7 text-base" onClick={onConfigSave}>
              Save config
            </Button>
          )}
        </div>
      </Section>

      <Separator />

      <Section title="Calibration">
        <CalibrationControls
          calibration={calibration}
          onChange={onCalibrationChange}
        />
      </Section>

      <Separator />

      <Section title="Pattern">
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center justify-between">
            <Label className="text-base">Pattern opacity</Label>
            <span className="text-base text-muted-foreground">
              {Math.round(patternOpacity * 100)}%
            </span>
          </div>
          <Slider
            min={0}
            max={1}
            step={0.01}
            value={[patternOpacity]}
            onValueChange={([v]) => onPatternOpacityChange(v)}
          />
        </div>
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
    </aside>
  )
}
