import { useCallback, useMemo } from "react";
import { useStore } from "@tanstack/react-store";
import { Button } from "@mupattern/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  workspaceStore,
  getWorkspaceVisiblePositionIndices,
  setCurrentIndex,
  setSelectedChannel,
  setSelectedZ,
} from "@/workspace/store";
import { setC as persistC, setZ as persistZ } from "@/see/store";

export function LeftSliceSidebar() {
  const activeWorkspace = useStore(workspaceStore, (s) => {
    const { activeId, workspaces } = s;
    if (!activeId) return null;
    return workspaces.find((w) => w.id === activeId) ?? null;
  });

  const visibleIndices = useMemo(() => {
    if (!activeWorkspace) return [];
    return getWorkspaceVisiblePositionIndices(activeWorkspace);
  }, [activeWorkspace]);

  const currentPosition = useMemo(() => {
    if (!activeWorkspace) return null;
    return activeWorkspace.positions[activeWorkspace.currentIndex] ?? null;
  }, [activeWorkspace]);

  const currentVisibleOffset = useMemo(() => {
    if (!activeWorkspace) return -1;
    return visibleIndices.indexOf(activeWorkspace.currentIndex);
  }, [activeWorkspace, visibleIndices]);

  const handlePositionChange = useCallback(
    (value: string) => {
      if (!activeWorkspace) return;
      const numericValue = Number.parseInt(value, 10);
      const nextIndex = visibleIndices.find(
        (index) => activeWorkspace.positions[index] === numericValue,
      );
      if (nextIndex == null || nextIndex === activeWorkspace.currentIndex) return;
      setCurrentIndex(activeWorkspace.id, nextIndex);
    },
    [activeWorkspace, visibleIndices],
  );

  const handlePrevPosition = useCallback(() => {
    if (!activeWorkspace || currentVisibleOffset <= 0) return;
    setCurrentIndex(activeWorkspace.id, visibleIndices[currentVisibleOffset - 1]);
  }, [activeWorkspace, currentVisibleOffset, visibleIndices]);

  const handleNextPosition = useCallback(() => {
    if (!activeWorkspace) return;
    if (currentVisibleOffset < 0 || currentVisibleOffset >= visibleIndices.length - 1) return;
    setCurrentIndex(activeWorkspace.id, visibleIndices[currentVisibleOffset + 1]);
  }, [activeWorkspace, currentVisibleOffset, visibleIndices]);

  const handleChannelChange = useCallback(
    (value: number) => {
      if (!activeWorkspace || value === activeWorkspace.selectedChannel) return;
      setSelectedChannel(activeWorkspace.id, value);
      persistC(value);
    },
    [activeWorkspace],
  );

  const handleChannelStep = useCallback(
    (delta: -1 | 1) => {
      if (!activeWorkspace) return;
      const i = activeWorkspace.channels.indexOf(activeWorkspace.selectedChannel);
      if (i < 0) return;
      const next = i + delta;
      if (next < 0 || next >= activeWorkspace.channels.length) return;
      const value = activeWorkspace.channels[next];
      setSelectedChannel(activeWorkspace.id, value);
      persistC(value);
    },
    [activeWorkspace],
  );

  const handleZChange = useCallback(
    (value: number) => {
      if (!activeWorkspace || value === activeWorkspace.selectedZ) return;
      setSelectedZ(activeWorkspace.id, value);
      persistZ(value);
    },
    [activeWorkspace],
  );

  const handleZStep = useCallback(
    (delta: -1 | 1) => {
      if (!activeWorkspace) return;
      const i = activeWorkspace.zSlices.indexOf(activeWorkspace.selectedZ);
      if (i < 0) return;
      const next = i + delta;
      if (next < 0 || next >= activeWorkspace.zSlices.length) return;
      const value = activeWorkspace.zSlices[next];
      setSelectedZ(activeWorkspace.id, value);
      persistZ(value);
    },
    [activeWorkspace],
  );

  if (!activeWorkspace || visibleIndices.length === 0) return null;

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
              onClick={handlePrevPosition}
              disabled={currentVisibleOffset <= 0}
              title="Previous position"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={currentPosition == null ? "" : String(currentPosition)}
              onChange={(e) => handlePositionChange(e.target.value)}
            >
              {visibleIndices.map((index) => {
                const pos = activeWorkspace.positions[index];
                return (
                  <option key={pos} value={String(pos)}>
                    {pos}
                  </option>
                );
              })}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleNextPosition}
              disabled={
                currentVisibleOffset < 0 || currentVisibleOffset >= visibleIndices.length - 1
              }
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
              disabled={activeWorkspace.channels.indexOf(activeWorkspace.selectedChannel) <= 0}
              title="Previous channel"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={activeWorkspace.selectedChannel}
              onChange={(e) => handleChannelChange(Number(e.target.value))}
            >
              {activeWorkspace.channels.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => handleChannelStep(1)}
              disabled={
                activeWorkspace.channels.indexOf(activeWorkspace.selectedChannel) >=
                activeWorkspace.channels.length - 1
              }
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
              disabled={activeWorkspace.zSlices.indexOf(activeWorkspace.selectedZ) <= 0}
              title="Previous z"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <select
              className="flex-1 border rounded px-2 py-1 bg-background text-sm"
              value={activeWorkspace.selectedZ}
              onChange={(e) => handleZChange(Number(e.target.value))}
            >
              {activeWorkspace.zSlices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => handleZStep(1)}
              disabled={
                activeWorkspace.zSlices.indexOf(activeWorkspace.selectedZ) >=
                activeWorkspace.zSlices.length - 1
              }
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
