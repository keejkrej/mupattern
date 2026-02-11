import { useState, useCallback, useEffect } from "react";
import { DirectoryStore } from "@/see/lib/directory-store";
import { listPositions, discoverStore, type StoreIndex } from "@/see/lib/zarr";
import { saveHandle, loadHandle } from "@/lib/idb-handle";
import { viewerStore, setSelectedPositions } from "@/see/store";

export function useZarrStore() {
  const [store, setStore] = useState<DirectoryStore | null>(null);
  const [dirHandle, setDirHandle] =
    useState<FileSystemDirectoryHandle | null>(null);
  const [index, setIndex] = useState<StoreIndex | null>(null);
  const [availablePositions, setAvailablePositions] = useState<string[] | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Try to restore a previously-saved directory handle on mount. */
  useEffect(() => {
    let cancelled = false;

    async function tryRestore() {
      const handle = await loadHandle("crops-zarr");
      if (!handle || cancelled) return;

      // Re-request read permission (browser may prompt the user)
      const perm = await handle.requestPermission({ mode: "read" });
      if (perm !== "granted" || cancelled) return;

      const ds = new DirectoryStore(handle);
      const positions = await listPositions(handle);
      if (positions.length === 0 || cancelled) return;

      setDirHandle(handle);
      setStore(ds);
      setAvailablePositions(positions);

      // If we had previously selected positions, auto-reload them
      const prevSelected = viewerStore.state.selectedPositions;
      if (prevSelected.length > 0) {
        // Filter to only positions that still exist
        const valid = prevSelected.filter((p) => positions.includes(p));
        if (valid.length > 0 && !cancelled) {
          setLoading(true);
          try {
            const idx = await discoverStore(handle, ds, valid);
            if (!cancelled && idx.positions.length > 0) {
              setIndex(idx);
            }
          } catch {
            // fall through to position picker
          } finally {
            if (!cancelled) setLoading(false);
          }
        }
      }
    }

    tryRestore();
    return () => { cancelled = true; };
  }, []);

  /** Phase 1: Open directory and quickly list available positions. */
  const openDirectory = useCallback(async () => {
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

      // Persist handle for next reload
      await saveHandle("crops-zarr", handle);

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
    [dirHandle, store]
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
