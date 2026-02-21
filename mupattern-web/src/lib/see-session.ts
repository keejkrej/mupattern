import type { DirectoryStore } from "@/see/lib/directory-store";

/**
 * Holds a pre-opened See session (directory + positions) when user picks
 * crops.zarr from the root Landing. Consumed by SeeApp on mount.
 */
let pending: {
  store: DirectoryStore;
  dirHandle: FileSystemDirectoryHandle;
  availablePositions: string[];
} | null = null;

export function setSeeSession(s: {
  store: DirectoryStore;
  dirHandle: FileSystemDirectoryHandle;
  availablePositions: string[];
}) {
  pending = s;
}

export function consumeSeeSession(): typeof pending {
  const p = pending;
  pending = null;
  return p;
}
