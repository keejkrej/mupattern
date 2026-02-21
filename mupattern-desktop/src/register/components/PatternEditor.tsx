import { memo } from "react";
import { Slider, Input, Label, Button } from "@mupattern/shared";
import { radToDeg, degToRad } from "@mupattern/shared/register/lib/units";
import type { Lattice, PatternConfigUm } from "@mupattern/shared/register/types";

interface PatternEditorProps {
  pattern: PatternConfigUm;
  latticeMinUm: number;
  onLatticeUpdate: (updates: Partial<Lattice>) => void;
  onWidthUpdate: (width: number) => void;
  onHeightUpdate: (height: number) => void;
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
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
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
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
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
  );
}

export const PatternEditor = memo(function PatternEditor({
  pattern,
  latticeMinUm,
  onLatticeUpdate,
  onWidthUpdate,
  onHeightUpdate,
}: PatternEditorProps) {
  const { lattice, width, height } = pattern;
  const alphaDeg = radToDeg(lattice.alpha);
  const betaDeg = radToDeg(lattice.beta);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <p className="text-base font-medium text-muted-foreground uppercase tracking-wider">
          Vector 1
        </p>
        <SliderRow
          label="a"
          value={lattice.a}
          min={latticeMinUm}
          max={200}
          step={0.5}
          unit="µm"
          onChange={(v) => onLatticeUpdate({ a: v })}
        />
        <SliderRow
          label="alpha"
          value={alphaDeg}
          min={-180}
          max={180}
          step={1}
          unit="deg"
          onChange={(v) => onLatticeUpdate({ alpha: degToRad(v) })}
        />
      </div>

      <div className="space-y-3">
        <p className="text-base font-medium text-muted-foreground uppercase tracking-wider">
          Vector 2
        </p>
        <SliderRow
          label="b"
          value={lattice.b}
          min={latticeMinUm}
          max={200}
          step={0.5}
          unit="µm"
          onChange={(v) => onLatticeUpdate({ b: v })}
        />
        <SliderRow
          label="beta"
          value={betaDeg}
          min={-180}
          max={180}
          step={1}
          unit="deg"
          onChange={(v) => onLatticeUpdate({ beta: degToRad(v) })}
        />
      </div>

      <div className="flex gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1 h-7 text-base"
          onClick={() => onLatticeUpdate({ beta: lattice.alpha + degToRad(90) })}
        >
          Square
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="flex-1 h-7 text-base"
          onClick={() => onLatticeUpdate({ beta: lattice.alpha + degToRad(60) })}
        >
          Hex
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-base font-medium text-muted-foreground uppercase tracking-wider">
          Shape
        </p>
        <SliderRow
          label="Width"
          value={width}
          min={0.5}
          max={100}
          step={0.5}
          unit="µm"
          onChange={onWidthUpdate}
        />
        <SliderRow
          label="Height"
          value={height}
          min={0.5}
          max={100}
          step={0.5}
          unit="µm"
          onChange={onHeightUpdate}
        />
      </div>
    </div>
  );
});
