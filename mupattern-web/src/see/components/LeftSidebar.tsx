import { Button } from "@mupattern/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface LeftSidebarProps {
  positions: string[];
  validPos: string;
  onPositionChange: (posId: string) => void;
  numChannels: number;
  channel: number;
  onChannelChange: (ch: number) => void;
  maxZ: number;
  z: number;
  onZChange: (z: number) => void;
}

export function LeftSidebar({
  positions,
  validPos,
  onPositionChange,
  numChannels,
  channel,
  onChannelChange,
  maxZ,
  z,
  onZChange,
}: LeftSidebarProps) {
  const handleChannelStep = (delta: -1 | 1) => {
    const next = Math.max(0, Math.min(numChannels - 1, channel + delta));
    if (next !== channel) onChannelChange(next);
  };

  const currentPosIndex = positions.indexOf(validPos);
  const handlePrevPos = () => {
    if (currentPosIndex > 0) onPositionChange(positions[currentPosIndex - 1]);
  };
  const handleNextPos = () => {
    if (currentPosIndex >= 0 && currentPosIndex < positions.length - 1) {
      onPositionChange(positions[currentPosIndex + 1]);
    }
  };

  const handleZStep = (delta: -1 | 1) => {
    const next = Math.max(0, Math.min(maxZ, z + delta));
    if (next !== z) onZChange(next);
  };

  return (
    <aside className="w-64 flex-shrink-0 overflow-y-auto border-r border-border p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Viewer Slice
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Choose position, channel, and z. Time is controlled by playback.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Position</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handlePrevPos}
              disabled={currentPosIndex <= 0}
              title="Previous position"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={validPos}
              onChange={(e) => onPositionChange(e.target.value)}
            >
              {positions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleNextPos}
              disabled={currentPosIndex < 0 || currentPosIndex >= positions.length - 1}
              title="Next position"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Channel</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => handleChannelStep(-1)}
              disabled={channel <= 0}
              title="Previous channel"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={channel}
              onChange={(e) => onChannelChange(Number(e.target.value))}
            >
              {Array.from({ length: numChannels }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => handleChannelStep(1)}
              disabled={channel >= numChannels - 1}
              title="Next channel"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Z</label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => handleZStep(-1)}
              disabled={z <= 0}
              title="Previous z"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={z}
              onChange={(e) => onZChange(Number(e.target.value))}
            >
              {Array.from({ length: maxZ + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => handleZStep(1)}
              disabled={z >= maxZ}
              title="Next z"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
