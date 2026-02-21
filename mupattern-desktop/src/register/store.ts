import { createPersistedStore } from "@mupattern/shared/lib/persist";
import {
  DEFAULT_PATTERN_UM,
  DEFAULT_TRANSFORM,
  DEFAULT_CALIBRATION,
  type PatternConfigUm,
  type Transform,
  type Calibration,
  type Lattice,
} from "@mupattern/shared/register/types";
import { normalizeAngleRad } from "@mupattern/shared/register/lib/units";

/** Workspace reference to reload image on page reload (small, persisted) */
export interface ImageSource {
  workspaceId: string;
  position: number;
  channel: number;
  time: number;
  z: number;
}

export interface ImagePixels {
  rgba: ArrayBuffer;
  width: number;
  height: number;
}

export interface AppState {
  started: boolean;
  /** Raw RGBA pixel buffer (no blob URL); null if "start fresh" */
  imagePixels: ImagePixels | null;
  /** Workspace reference to reload from; not the image data */
  imageSource: ImageSource | null;
  imageBaseName: string;
  canvasSize: { width: number; height: number };
  pattern: PatternConfigUm;
  transform: Transform;
  calibration: Calibration;
  patternOpacity: number;
  detectedPoints: Array<{ x: number; y: number }> | null;
}

const defaultState: AppState = {
  started: false,
  imagePixels: null,
  imageSource: null,
  imageBaseName: "pattern",
  canvasSize: { width: 2048, height: 2048 },
  pattern: DEFAULT_PATTERN_UM,
  transform: DEFAULT_TRANSFORM,
  calibration: DEFAULT_CALIBRATION,
  patternOpacity: 0.5,
  detectedPoints: null,
};

export const appStore = createPersistedStore<AppState>("mustudio-register-app", defaultState, {
  serialize: (state) => ({
    ...state,
    // Never persist image payload; persist imageSource so reload can fetch from workspace
    imagePixels: null,
    started: state.imagePixels ? true : state.started,
  }),
  debounceMs: 500,
  deserialize: (raw) => {
    const persisted = (raw as Partial<AppState>) ?? {};
    const src = persisted.imageSource;
    const imageSource =
      src &&
      typeof src.workspaceId === "string" &&
      typeof src.position === "number" &&
      typeof src.channel === "number" &&
      typeof src.time === "number" &&
      typeof src.z === "number"
        ? (src as ImageSource)
        : null;
    return {
      ...defaultState,
      ...persisted,
      imagePixels: null,
      imageSource,
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
      patternOpacity:
        typeof persisted.patternOpacity === "number"
          ? Math.max(0, Math.min(1, persisted.patternOpacity))
          : defaultState.patternOpacity,
    };
  },
});

// --- Actions ---

export function startWithImage(
  rgba: ArrayBuffer,
  filename: string,
  width: number,
  height: number,
  imageSource?: ImageSource | null,
) {
  appStore.setState((s) => ({
    ...s,
    started: true,
    imagePixels: { rgba, width, height },
    imageSource: imageSource ?? s.imageSource,
    imageBaseName: filename,
    canvasSize: { width, height },
  }));
}

export function setImageSource(imageSource: ImageSource | null) {
  appStore.setState((s) => ({ ...s, imageSource }));
}

export function startFresh(width: number, height: number) {
  appStore.setState((s) => ({
    ...s,
    started: true,
    imagePixels: null,
    imageBaseName: "pattern",
    canvasSize: { width, height },
  }));
}

export function setPattern(pattern: PatternConfigUm) {
  appStore.setState((s) => ({
    ...s,
    pattern,
  }));
}

export function updateLattice(updates: Partial<Lattice>) {
  const normalized: Partial<Lattice> = { ...updates };
  if (updates.alpha !== undefined) normalized.alpha = normalizeAngleRad(updates.alpha);
  if (updates.beta !== undefined) normalized.beta = normalizeAngleRad(updates.beta);
  appStore.setState((s) => ({
    ...s,
    pattern: { ...s.pattern, lattice: { ...s.pattern.lattice, ...normalized } },
  }));
}

export function updateWidth(width: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: { ...s.pattern, width },
  }));
}

export function updateHeight(height: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: { ...s.pattern, height },
  }));
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
  }));
}

export function rotatePattern(deltaRad: number) {
  appStore.setState((s) => ({
    ...s,
    pattern: {
      ...s.pattern,
      lattice: {
        ...s.pattern.lattice,
        alpha: normalizeAngleRad(s.pattern.lattice.alpha + deltaRad),
        beta: normalizeAngleRad(s.pattern.lattice.beta + deltaRad),
      },
    },
  }));
}

export function updateTransform(updates: Partial<Transform>) {
  appStore.setState((s) => ({
    ...s,
    transform: { ...s.transform, ...updates },
  }));
}

export function setCalibration(cal: Calibration) {
  if (cal.umPerPixel > 0) {
    appStore.setState((s) => ({ ...s, calibration: cal }));
  }
}

export function setPatternOpacity(patternOpacity: number) {
  appStore.setState((s) => ({ ...s, patternOpacity: Math.max(0, Math.min(1, patternOpacity)) }));
}

export function resetPatternAndTransform() {
  appStore.setState((s) => ({
    ...s,
    pattern: DEFAULT_PATTERN_UM,
    transform: DEFAULT_TRANSFORM,
  }));
}

export function setDetectedPoints(points: Array<{ x: number; y: number }>) {
  appStore.setState((s) => ({ ...s, detectedPoints: points }));
}

export function clearDetectedPoints() {
  appStore.setState((s) => ({ ...s, detectedPoints: null }));
}
