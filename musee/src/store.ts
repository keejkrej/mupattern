import { createPersistedStore } from "@/lib/persist"

export interface ViewerState {
  /** Annotations as [key, value] pairs (Map can't be JSON-serialized directly) */
  annotations: [string, boolean][]
  selectedPos: string
  t: number
  c: number
  page: number
  contrastMin: number
  contrastMax: number
  annotating: boolean
  /** Which positions were selected in the picker (for auto-reload) */
  selectedPositions: string[]
}

const defaultState: ViewerState = {
  annotations: [],
  selectedPos: "",
  t: 0,
  c: 0,
  page: 0,
  contrastMin: 0,
  contrastMax: 65535,
  annotating: false,
  selectedPositions: [],
}

export const viewerStore = createPersistedStore<ViewerState>(
  "musee-viewer",
  defaultState,
  { debounceMs: 500 }
)

// --- Actions ---

export function setAnnotations(annotations: Map<string, boolean>) {
  viewerStore.setState((s) => ({
    ...s,
    annotations: [...annotations.entries()],
  }))
}

export function setSelectedPos(selectedPos: string) {
  viewerStore.setState((s) => ({ ...s, selectedPos, page: 0 }))
}

export function setT(t: number) {
  viewerStore.setState((s) => ({ ...s, t }))
}

export function setC(c: number) {
  viewerStore.setState((s) => ({ ...s, c }))
}

export function setPage(page: number) {
  viewerStore.setState((s) => ({ ...s, page }))
}

export function setContrast(contrastMin: number, contrastMax: number) {
  viewerStore.setState((s) => ({ ...s, contrastMin, contrastMax }))
}

export function setAnnotating(annotating: boolean) {
  viewerStore.setState((s) => ({ ...s, annotating }))
}

export function setSelectedPositions(selectedPositions: string[]) {
  viewerStore.setState((s) => ({ ...s, selectedPositions }))
}

// --- Helpers ---

export function getAnnotationsMap(): Map<string, boolean> {
  return new Map(viewerStore.state.annotations)
}
