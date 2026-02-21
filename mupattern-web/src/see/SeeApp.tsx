import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useZarrStore } from "@/see/hooks/useZarrStore";
import { Viewer } from "@/see/components/Viewer";
import { PositionPickerScreen } from "@/see/components/PositionPickerScreen";

export default function SeeApp() {
  useEffect(() => {
    document.title = "See - MuPattern";
    return () => {
      document.title = "MuPattern";
    };
  }, []);

  const { store, index, availablePositions, loading, error, loadPositions } = useZarrStore();

  // State 3: Viewer — positions loaded, show the viewer
  if (store && index) {
    return <Viewer store={store} index={index} />;
  }

  // State 2: Position picker — directory opened, positions discovered, awaiting selection
  if (store && availablePositions) {
    return (
      <PositionPickerScreen
        positions={availablePositions}
        loading={loading}
        error={error}
        onConfirm={loadPositions}
      />
    );
  }

  // No session (reload) — back to landing
  return <Navigate to="/" replace />;
}
