import { createPersistedStore } from "@/register/lib/persist"
import {
  DEFAULT_PATTERN_UM,
  DEFAULT_TRANSFORM,
  DEFAULT_CALIBRATION,
  type PatternConfigUm,
  type Transform,
  type Calibration,
  type Lattice,
} from "@/register/types"

export interface AppState {
  started: boolean
  /** Data URL of the loaded image, or null if "start fresh" */
  imageDataURL: string | null
  imageBaseName: string
  canvasSize: { width: number; height: number }
  pattern: PatternConfigUm
  transform: Transform
  calibration: Calibration
  patternOpacity: number
  detectedPoints: Array<{ x: number; y: number }> | null
}

const defaultState: AppState = {
  started: false,
  imageDataURL: null,
  imageBaseName: "pattern",
  canvasSize: { width: 2048, height: 2048 },
  pattern: DEFAULT_PATTERN_UM,
  transform: DEFAULT_TRANSFORM,
  calibration: DEFAULT_CALIBRATION,
  patternOpacity: 0.7,
  detectedPoints: null,
}

export const appStore = createPersistedStore<AppState>("mustudio-register-app", defaultState, {
  serialize: (state) => ({
    ...state,
    // Avoid persisting large base64 payloads that can block the UI thread.
    imageDataURL: null,
    started: state.imageDataURL ? false : state.started,
  }),
  debounceMs: 500,
  deserialize: (raw) => {
    const persisted = (raw as Partial<AppState>) ?? {}
    return {
      ...defaultState,
      ...persisted,
      canvasSize: { ...defaultState.canvasSize, ...(persisted.canvasSize ?? {}) },
      pattern: {
        ...defaultState.pattern,
        ...(persisted.pattern ?? {}),
        lattice: {
          ...defaultState.pattern.lattice,
          ...(persisted.pattern?.lattice ?? {}),
        },
      },
      transform: { ...defaultState.transform, ...(persisted.transform ?? {}) },
      calibration: { ...defaultState.calibration, ...(persisted.calibration ?? {}) },
      patternOpacity: typeof persisted.patternOpacity === "number"
        ? Math.max(0, Math.min(1, persisted.patternOpacity))
        : defaultState.patternOpacity,
    }
  },
})

// --- Actions ---

export function startWithImage(imageDataURL: string, filename: string, width: number, height: number) {
  appStore.setState((s) => ({
    ...s,
    started: true,
    imageDataURL,
    imageBaseName: filename,
    canvasSize: { width, height },
  }))
}

export function startFresh(width: number, height: number) {
  appStore.setState((s) => ({
    ...s,
    started: true,
    imageDataURL: null,
    imageBaseName: "pattern",
    canvasSize: { width, height },
  }))
}

export function loadImage(imageDataURL: string, filename: string, width: number, height: number) {
  appStore.setState((s) => ({
    ...s,
    imageDataURL,
    imageBaseName: filename,
    canvasSize: { width, height },
  }))
}

export function setPattern(pattern: PatternConfigUm) {
  appStore.setState((s) => ({
    ...s,
    pattern,
  }))
}

export function updateLattice(updates: Partial<Lattice>) {
  appStore.setState((s) => ({
    ...s,
    pattern: { ...s.pattern, lattice: { ...s.pattern.lattice, ...updates } },
  }))
}

export function updateWidth(width: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: { ...s.pattern, width },
  }))
}

export function updateHeight(height: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: { ...s.pattern, height },
  }))
}

export function scalePattern(factor: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: {
      ...s.pattern,
      lattice: {
        ...s.pattern.lattice,
        a: s.pattern.lattice.a * factor,
        b: s.pattern.lattice.b * factor,
      },
      width: s.pattern.width * factor,
      height: s.pattern.height * factor,
    },
  }))
}

export function rotatePattern(deltaRad: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: {
      ...s.pattern,
      lattice: {
        ...s.pattern.lattice,
        alpha: s.pattern.lattice.alpha + deltaRad,
        beta: s.pattern.lattice.beta + deltaRad,
      },
    },
  }))
}

export function updateTransform(updates: Partial<Transform>) {
  appStore.setState((s) => ({
    ...s,
    transform: { ...s.transform, ...updates },
  }))
}

export function setCalibration(cal: Calibration) {
  if (cal.umPerPixel > 0) {
    appStore.setState((s) => ({ ...s, calibration: cal }))
  }
}

export function setPatternOpacity(patternOpacity: number) {
  appStore.setState((s) => ({ ...s, patternOpacity: Math.max(0, Math.min(1, patternOpacity)) }))
}

export function resetPatternAndTransform() {
  appStore.setState((s) => ({
    ...s,
    pattern: DEFAULT_PATTERN_UM,
    transform: DEFAULT_TRANSFORM,
  }))
}

export function setDetectedPoints(points: Array<{ x: number; y: number }>) {
  appStore.setState((s) => ({ ...s, detectedPoints: points }))
}

export function clearDetectedPoints() {
  appStore.setState((s) => ({ ...s, detectedPoints: null }))
}
