import { useState, useCallback, useEffect } from "react";
import { consumeSeeSession } from "@/lib/see-session";
import { DirectoryStore } from "@/see/lib/directory-store";
import { listPositions, discoverStore, type StoreIndex } from "@/see/lib/zarr";
import { setSelectedPositions } from "@/see/store";

let initSession: ReturnType<typeof consumeSeeSession> | undefined = undefined;
function getInitSeeSession() {
  if (initSession === undefined) {
    initSession = consumeSeeSession();
  }
  return initSession;
}

export function useZarrStore() {
  const [store, setStore] = useState<DirectoryStore | null>(
    () => getInitSeeSession()?.store ?? null,
  );
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(
    () => getInitSeeSession()?.dirHandle ?? null,
  );
  const [index, setIndex] = useState<StoreIndex | null>(null);
  const [availablePositions, setAvailablePositions] = useState<string[] | null>(
    () => getInitSeeSession()?.availablePositions ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      initSession = undefined;
    },
    [],
  );

  /** Phase 1: Open directory and quickly list available positions. */
  const openDirectory = useCallback(async () => {
    if (typeof window.showDirectoryPicker !== "function") {
      setError("See requires Chrome or Edge. Safari and Firefox are not supported.");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setIndex(null);
      setAvailablePositions(null);

      const handle = await window.showDirectoryPicker({ mode: "read" });
      const ds = new DirectoryStore(handle);
      const positions = await listPositions(handle);

      if (positions.length === 0) {
        setError("No positions found. Expected layout: pos/{id}/crop/{id}/");
        return;
      }

      setDirHandle(handle);
      setStore(ds);
      setAvailablePositions(positions);
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** Phase 2: Load crops for the selected positions only. */
  const loadPositions = useCallback(
    async (selected: string[]) => {
      if (!dirHandle || !store) return;
      try {
        setLoading(true);
        setError(null);
        const idx = await discoverStore(dirHandle, store, selected);

        if (idx.positions.length === 0) {
          setError("No crops found in the selected positions.");
          return;
        }

        // Persist which positions were selected
        setSelectedPositions(selected);
        setIndex(idx);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [dirHandle, store],
  );

  return {
    store,
    dirHandle,
    index,
    availablePositions,
    loading,
    error,
    openDirectory,
    loadPositions,
  };
}
