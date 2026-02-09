// --- Calibration ---

export interface Calibration {
  umPerPixel: number // micrometers per pixel
}

export const DEFAULT_CALIBRATION: Calibration = {
  umPerPixel: 0.65, // 10x objective
}

// --- Lattice (shared shape, units vary by context) ---

export interface Lattice {
  a: number     // length of vector 1
  alpha: number // angle of vector 1 (radians)
  b: number     // length of vector 2
  beta: number  // angle of vector 2 (radians)
}

// --- Pattern config in micrometers (source of truth) ---

export interface PatternConfigUm {
  lattice: Lattice   // lengths in µm, angles in radians
  width: number       // µm
  height: number      // µm
}

// --- Pattern in pixels (derived for canvas rendering) ---

export interface PatternPixels {
  lattice: Lattice   // lengths in pixels, angles in radians
  width: number       // pixels
  height: number      // pixels
}


// --- Transform (always pixels — canvas operation) ---

export interface Transform {
  tx: number // translation x (pixels)
  ty: number // translation y (pixels)
}

export const DEFAULT_TRANSFORM: Transform = {
  tx: 0,
  ty: 0,
}

// --- Defaults (µm units, ≈50px and 10px at 0.65 µm/px) ---

export const DEFAULT_LATTICE_UM: Lattice = {
  a: 75,
  alpha: 0,
  b: 75,
  beta: Math.PI / 2,
}

export const DEFAULT_PATTERN_UM: PatternConfigUm = {
  lattice: DEFAULT_LATTICE_UM,
  width: 50,
  height: 50,
}
