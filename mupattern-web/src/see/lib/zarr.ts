/**
 * Zarr tree discovery and data access.
 *
 * Layout: /pos/{posId}/crop/{cropId} → TCZYX arrays
 */

import * as zarr from "zarrita";
import type { DirectoryStore } from "./directory-store";

export interface CropInfo {
  posId: string;
  cropId: string;
  /** TCZYX shape */
  shape: readonly number[];
  bbox?: { x: number; y: number; w: number; h: number; crop: number };
}

export interface StoreIndex {
  positions: string[];
  crops: Map<string, CropInfo[]>;
}

/** List immediate subdirectory names. */
async function listDirs(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/**
 * Quick scan: list just the position IDs without reading any zarr arrays.
 */
export async function listPositions(rootDirHandle: FileSystemDirectoryHandle): Promise<string[]> {
  let posDir: FileSystemDirectoryHandle;
  try {
    posDir = await rootDirHandle.getDirectoryHandle("pos");
  } catch {
    return [];
  }

  const posIds = await listDirs(posDir);

  // Filter to only positions that actually have a crop/ subdirectory
  const valid: string[] = [];
  for (const posId of posIds) {
    try {
      const posHandle = await posDir.getDirectoryHandle(posId);
      await posHandle.getDirectoryHandle("crop");
      valid.push(posId);
    } catch {
      continue;
    }
  }

  return valid;
}

/**
 * Discover positions and crops inside a crops.zarr directory handle.
 * If `positionFilter` is provided, only those positions are scanned.
 */
export async function discoverStore(
  rootDirHandle: FileSystemDirectoryHandle,
  store: DirectoryStore,
  positionFilter?: string[],
): Promise<StoreIndex> {
  const positions: string[] = [];
  const crops = new Map<string, CropInfo[]>();

  let posDir: FileSystemDirectoryHandle;
  try {
    posDir = await rootDirHandle.getDirectoryHandle("pos");
  } catch {
    return { positions, crops };
  }

  const root = zarr.root(store);
  const posIds = positionFilter ?? (await listDirs(posDir));

  for (const posId of posIds) {
    let cropDir: FileSystemDirectoryHandle;
    try {
      const posHandle = await posDir.getDirectoryHandle(posId);
      cropDir = await posHandle.getDirectoryHandle("crop");
    } catch {
      continue;
    }

    const cropIds = await listDirs(cropDir);
    if (cropIds.length === 0) continue;

    positions.push(posId);
    const infos: CropInfo[] = [];

    for (const cropId of cropIds) {
      try {
        const arr = await zarr.open.v3(root.resolve(`pos/${posId}/crop/${cropId}`), {
          kind: "array",
        });
        const attrs = (arr.attrs ?? {}) as Record<string, unknown>;
        infos.push({
          posId,
          cropId,
          shape: arr.shape,
          bbox: attrs.bbox as CropInfo["bbox"],
        });
      } catch {
        // skip
      }
    }

    crops.set(posId, infos);
  }

  return { positions, crops };
}

/**
 * Load a single (t, c, z) chunk → { data, height, width }.
 */
export async function loadFrame(
  store: DirectoryStore,
  posId: string,
  cropId: string,
  t: number,
  c: number = 0,
  z: number = 0,
): Promise<{ data: Uint16Array; height: number; width: number }> {
  const root = zarr.root(store);
  const arr = await zarr.open.v3(root.resolve(`pos/${posId}/crop/${cropId}`), {
    kind: "array",
  });

  const chunk = await arr.getChunk([t, c, z, 0, 0]);
  // chunk.shape is the full chunk shape: [1, 1, 1, H, W]
  const height = chunk.shape[chunk.shape.length - 2];
  const width = chunk.shape[chunk.shape.length - 1];
  return {
    data: chunk.data as Uint16Array,
    height,
    width,
  };
}
