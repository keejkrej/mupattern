import { createPersistedStore } from "@mupattern/shared/lib/persist";

export interface ViewerState {
  /** Annotations as [key, value] pairs (Map can't be JSON-serialized directly) */
  annotations: [string, boolean][];
  /** Spots as [key, spots[]] pairs keyed by "t:cropId" */
  spots: [string, { y: number; x: number }[]][];
  /** Absolute path to loaded masks zarr folder (e.g. .../masks_fl.zarr), or null if not loaded */
  masksPath: string | null;
  selectedPos: string;
  t: number;
  c: number;
  z: number;
  page: number;
  contrastMin: number;
  contrastMax: number;
  annotating: boolean;
  showAnnotations: boolean;
  showSpots: boolean;
  showMasks: boolean;
  /** Which positions were selected in the picker (for auto-reload) */
  selectedPositions: string[];
}

const defaultState: ViewerState = {
  annotations: [],
  spots: [],
  masksPath: null,
  selectedPos: "",
  t: 0,
  c: 0,
  z: 0,
  page: 0,
  contrastMin: 0,
  contrastMax: 65535,
  annotating: false,
  showAnnotations: true,
  showSpots: true,
  showMasks: true,
  selectedPositions: [],
};

export const viewerStore = createPersistedStore<ViewerState>("mustudio-see-viewer", defaultState, {
  debounceMs: 500,
  deserialize: (raw) => ({
    ...defaultState,
    ...(raw as Partial<ViewerState>),
  }),
});

// --- Actions ---

export function setAnnotations(annotations: Map<string, boolean>) {
  viewerStore.setState((s) => ({
    ...s,
    annotations: [...annotations.entries()],
  }));
}

export function setSelectedPos(selectedPos: string) {
  viewerStore.setState((s) => ({ ...s, selectedPos, page: 0 }));
}

export function setT(t: number) {
  viewerStore.setState((s) => ({ ...s, t }));
}

export function setC(c: number) {
  viewerStore.setState((s) => ({ ...s, c }));
}

export function setZ(z: number) {
  viewerStore.setState((s) => ({ ...s, z }));
}

export function setPage(page: number) {
  viewerStore.setState((s) => ({ ...s, page }));
}

export function setContrast(contrastMin: number, contrastMax: number) {
  viewerStore.setState((s) => ({ ...s, contrastMin, contrastMax }));
}

export function setAnnotating(annotating: boolean) {
  viewerStore.setState((s) => ({ ...s, annotating }));
}

export function setSelectedPositions(selectedPositions: string[]) {
  viewerStore.setState((s) => ({ ...s, selectedPositions }));
}

export function setSpots(spots: Map<string, { y: number; x: number }[]>) {
  viewerStore.setState((s) => ({
    ...s,
    spots: [...spots.entries()],
  }));
}

export function setShowAnnotations(showAnnotations: boolean) {
  viewerStore.setState((s) => ({ ...s, showAnnotations }));
}

export function setShowSpots(showSpots: boolean) {
  viewerStore.setState((s) => ({ ...s, showSpots }));
}

export function setShowMasks(showMasks: boolean) {
  viewerStore.setState((s) => ({ ...s, showMasks }));
}

export function setMasksPath(masksPath: string | null) {
  viewerStore.setState((s) => ({ ...s, masksPath }));
}

// --- Helpers ---

export function getAnnotationsMap(): Map<string, boolean> {
  return new Map(viewerStore.state.annotations);
}
