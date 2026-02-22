import { Button } from "@mupattern/shared";

interface LeftSidebarProps {
  hasImage: boolean;
  hasDetectedPoints: boolean;
  onDetect: () => void;
  onFitGrid: (basisAngle: number) => void;
  onReset: () => void;
  onSave: () => void;
}

export function LeftSidebar({
  hasImage,
  hasDetectedPoints,
  onDetect,
  onFitGrid,
  onReset,
  onSave,
}: LeftSidebarProps) {
  return (
    <aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-border p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Actions
        </h2>
        <div className="space-y-2">
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
          <Button variant="secondary" size="sm" className="flex-1 h-7 text-base" onClick={onSave}>
            Save
          </Button>
        </div>
        </div>
      </div>
    </aside>
  );
}
