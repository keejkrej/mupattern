import { Slider } from "@mupattern/ui/components/ui/slider"
import { Input } from "@mupattern/ui/components/ui/input"
import { Label } from "@mupattern/ui/components/ui/label"
import type { Transform } from "@/types"

interface TransformEditorProps {
  transform: Transform
  onUpdate: (updates: Partial<Transform>) => void
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-base">{label}</Label>
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(2))}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
            }}
            className="h-6 w-20 text-base text-right"
          />
          <span className="text-base text-muted-foreground w-5">{unit}</span>
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  )
}

export function TransformEditor({ transform, onUpdate }: TransformEditorProps) {
  return (
    <div className="space-y-3">
      <SliderRow label="Translate X" value={transform.tx} min={-500} max={500} step={0.5} unit="px"
        onChange={(v) => onUpdate({ tx: v })} />
      <SliderRow label="Translate Y" value={transform.ty} min={-500} max={500} step={0.5} unit="px"
        onChange={(v) => onUpdate({ ty: v })} />
    </div>
  )
}
