import { Input, Label, Slider, Button } from "@mupattern/shared";
import type { Calibration } from "@mupattern/shared/register/types";

interface CalibrationControlsProps {
  calibration: Calibration;
  onChange: (cal: Calibration) => void;
}

const PRESETS = [
  { label: "10x", umPerPixel: 0.65 },
  { label: "20x", umPerPixel: 0.325 },
  { label: "40x", umPerPixel: 0.1625 },
] as const;

export function CalibrationControls({ calibration, onChange }: CalibrationControlsProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-base">µm / pixel</Label>
          <Input
            type="number"
            min={0.001}
            max={5}
            step={0.001}
            value={Number(calibration.umPerPixel.toFixed(4))}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v > 0) onChange({ umPerPixel: v });
            }}
            className="h-6 w-20 text-base text-right"
          />
        </div>
        <Slider
          min={0.01}
          max={5}
          step={0.001}
          value={[calibration.umPerPixel]}
          onValueChange={([v]) => onChange({ umPerPixel: v })}
        />
      </div>
      <div className="flex gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant={calibration.umPerPixel === p.umPerPixel ? "default" : "secondary"}
            size="sm"
            className="flex-1 h-7 text-base"
            onClick={() => onChange({ umPerPixel: p.umPerPixel })}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
