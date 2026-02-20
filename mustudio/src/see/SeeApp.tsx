import { useZarrStore } from "@/see/hooks/useZarrStore";
import { Viewer } from "@/see/components/Viewer";
import { Landing } from "@/see/components/Landing";

export default function SeeApp() {
  const { store, index, loading, error } = useZarrStore();

  if (store && index) {
    return <Viewer store={store} index={index} />;
  }

  return <Landing loading={loading} error={error} />;
}
