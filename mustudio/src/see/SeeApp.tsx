import { useZarrStore } from "@/see/hooks/useZarrStore";
import { Viewer } from "@/see/components/Viewer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { HexBackground } from "@/components/HexBackground";

export default function SeeApp() {
  const { theme } = useTheme();
  const {
    store,
    index,
    loading,
    error,
  } = useZarrStore();

  if (store && index) {
    return <Viewer store={store} index={index} />;
  }

  return (
    <div className="relative flex flex-col items-center justify-center h-screen gap-6">
      <HexBackground theme={theme} />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <h1 className="text-4xl tracking-tight" style={{ fontFamily: '"Bitcount", monospace' }}>MuSee</h1>
      <p className="text-muted-foreground text-center max-w-md">
        {loading ? "Loading crops.zarr from workspace..." : "Could not open workspace crops.zarr."}
      </p>
      {error && (
        <p className="text-destructive text-sm max-w-md text-center">
          {error}
        </p>
      )}
    </div>
  );
}
