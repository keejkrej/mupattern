import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@mupattern/ui/components/ui/dialog";
import { Button } from "@mupattern/ui/components/ui/button";
import { Checkbox } from "@mupattern/ui/components/ui/checkbox";
import { ChevronLeft, ChevronRight } from "lucide-react";

const POS_PER_PAGE = 30; // 5 columns x 6 rows
const MAX_POSITIONS = 10;

interface PositionPickerProps {
  positions: string[];
  loading: boolean;
  onConfirm: (selected: string[]) => void;
}

export function PositionPicker({
  positions,
  loading,
  onConfirm,
}: PositionPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(positions.slice(0, MAX_POSITIONS))
  );
  const [page, setPage] = useState(0);

  const totalPages = Math.ceil(positions.length / POS_PER_PAGE);
  const pagePositions = useMemo(
    () => positions.slice(page * POS_PER_PAGE, (page + 1) * POS_PER_PAGE),
    [positions, page]
  );

  const atLimit = selected.size >= MAX_POSITIONS;

  const toggle = useCallback((posId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(posId)) {
        next.delete(posId);
      } else if (next.size < MAX_POSITIONS) {
        next.add(posId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(positions.slice(0, MAX_POSITIONS)));
  }, [positions]);

  const selectNone = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pagePositions) {
        if (next.size >= MAX_POSITIONS) break;
        next.add(p);
      }
      return next;
    });
  }, [pagePositions]);

  const deselectPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of pagePositions) next.delete(p);
      return next;
    });
  }, [pagePositions]);

  const handleConfirm = useCallback(() => {
    const ordered = positions.filter((p) => selected.has(p));
    onConfirm(ordered);
  }, [positions, selected, onConfirm]);

  const pageSelectedCount = pagePositions.filter((p) => selected.has(p)).length;
  const allPageSelected = pageSelectedCount === pagePositions.length;

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Select positions to load</DialogTitle>
          <DialogDescription>
            Found {positions.length} position{positions.length !== 1 && "s"}.
            Choose up to {MAX_POSITIONS} to load into the viewer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={selectAll}
            className="text-muted-foreground hover:text-foreground underline"
          >
            Select first {Math.min(MAX_POSITIONS, positions.length)}
          </button>
          <button
            onClick={selectNone}
            className="text-muted-foreground hover:text-foreground underline"
          >
            Select none
          </button>
          <span className={`text-sm tabular-nums ${atLimit ? "text-amber-500" : "text-muted-foreground"}`}>
            {selected.size}/{MAX_POSITIONS}
          </span>
          {totalPages > 1 && (
            <>
              <span className="text-muted-foreground">|</span>
              <button
                onClick={allPageSelected ? deselectPage : selectPage}
                className="text-muted-foreground hover:text-foreground underline"
              >
                {allPageSelected ? "Deselect" : "Select"} page
              </button>
            </>
          )}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 py-1">
          {pagePositions.map((posId) => {
            const isSelected = selected.has(posId);
            const disabled = !isSelected && atLimit;
            return (
              <label
                key={posId}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                  disabled
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:bg-accent"
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  disabled={disabled}
                  onCheckedChange={() => toggle(posId)}
                />
                Pos {posId}
              </label>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="size-3" />
            </Button>
            <span className="text-sm tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="size-3" />
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button
            onClick={handleConfirm}
            disabled={selected.size === 0 || loading}
            className="w-full sm:w-auto"
          >
            {loading
              ? "Loading..."
              : `Load ${selected.size} position${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
