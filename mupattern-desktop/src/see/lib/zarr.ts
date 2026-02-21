/**
 * Zarr tree discovery and data access via Electron main process.
 *
 * Layout: /crops.zarr/pos/{posId}/crop/{cropId} → TCZYX arrays
 */

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

export interface DiscoverStoreOptions {
  metadataMode?: "full" | "fast";
}

export interface ZarrStore {
  workspacePath: string;
}

export function createZarrStore(workspacePath: string): ZarrStore {
  return { workspacePath };
}

/**
 * Discover positions/crops in a workspace's crops.zarr.
 * If `positionFilter` is provided, only those positions are scanned.
 */
export async function discoverStore(
  workspacePath: string,
  positionFilter?: string[],
  options: DiscoverStoreOptions = {},
): Promise<StoreIndex> {
  const response = await window.mupatternDesktop.zarr.discover({
    workspacePath,
    positionFilter,
    metadataMode: options.metadataMode ?? "full",
  });

  const crops = new Map<string, CropInfo[]>();
  for (const [posId, infos] of Object.entries(response.crops)) {
    crops.set(
      posId,
      infos.map((info) => ({
        posId: info.posId,
        cropId: info.cropId,
        shape: info.shape,
      })),
    );
  }

  return {
    positions: response.positions,
    crops,
  };
}

/**
 * Load a single (t, c, z) chunk → { data, height, width }.
 */
export async function loadFrame(
  store: ZarrStore,
  posId: string,
  cropId: string,
  t: number,
  c: number = 0,
  z: number = 0,
): Promise<{ data: Uint16Array; height: number; width: number }> {
  const response = await window.mupatternDesktop.zarr.loadFrame({
    workspacePath: store.workspacePath,
    posId,
    cropId,
    t,
    c,
    z,
  });

  if (!response.ok) {
    throw new Error(response.error);
  }

  return {
    data: new Uint16Array(response.data),
    height: response.height,
    width: response.width,
  };
}

/**
 * Check whether the given masks zarr path exists and has pos/ layout.
 */
export async function hasMasks(masksPath: string): Promise<boolean> {
  const response = await window.mupatternDesktop.zarr.hasMasks({ masksPath });
  return response.hasMasks;
}

/**
 * Load a single mask frame (t) for a crop → { data, height, width }.
 * Layout: masks.zarr/pos/{posId}/crop/{cropId} with (T, H, W) uint32.
 */
export async function loadMaskFrame(
  masksPath: string,
  posId: string,
  cropId: string,
  t: number,
): Promise<{ data: Uint32Array; height: number; width: number }> {
  const response = await window.mupatternDesktop.zarr.loadMaskFrame({
    masksPath,
    posId,
    cropId,
    t,
  });

  if (!response.ok) {
    throw new Error(response.error);
  }

  return {
    data: new Uint32Array(response.data),
    height: response.height,
    width: response.width,
  };
}
