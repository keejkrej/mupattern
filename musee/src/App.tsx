import { useZarrStore } from "@/hooks/useZarrStore";
import { Viewer } from "@/components/Viewer";
import { PositionPicker } from "@/components/PositionPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { HexBackground } from "@mupattern/ui/components/HexBackground";
import { Button } from "@mupattern/ui/components/ui/button";
import { FolderOpen } from "lucide-react";

export default function App() {
  const { theme } = useTheme();
  const {
    store,
    index,
    availablePositions,
    loading,
    error,
    openDirectory,
    loadPositions,
  } = useZarrStore();

  // State 3: Viewer — positions loaded, show the viewer
  if (store && index) {
    return <Viewer store={store} index={index} />;
  }

  // State 2: Position picker — directory opened, positions discovered, awaiting selection
  if (store && availablePositions) {
    return (
      <div className="relative flex flex-col items-center justify-center h-screen gap-6">
        <HexBackground theme={theme} />
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>MuSee</h1>
        <p className="text-muted-foreground text-center max-w-md">
          Select which positions to load into the viewer.
        </p>
        {error && (
          <p className="text-destructive text-sm max-w-md text-center">
            {error}
          </p>
        )}
        <PositionPicker
          positions={availablePositions}
          loading={loading}
          onConfirm={loadPositions}
        />
      </div>
    );
  }

  // State 1: Landing — prompt user to open a directory
  return (
    <div className="relative flex flex-col items-center justify-center h-screen gap-6">
      <HexBackground theme={theme} />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>MuSee</h1>
      <p className="text-muted-foreground text-center max-w-md">
        Open a crops.zarr directory to browse cropped micropattern cells.
      </p>
      <Button onClick={openDirectory} disabled={loading} size="lg" className="whitespace-nowrap">
        <FolderOpen className="size-5" />
        {loading ? "Loading..." : "Open crops.zarr"}
      </Button>
      {error && (
        <p className="text-destructive text-sm max-w-md text-center">
          {error}
        </p>
      )}
    </div>
  );
}
