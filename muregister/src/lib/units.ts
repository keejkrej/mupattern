import type { Calibration, PatternConfigUm, PatternPixels } from "@/types"

export function umToPixels(um: number, cal: Calibration): number {
  return um / cal.umPerPixel
}

export function pixelsToUm(px: number, cal: Calibration): number {
  return px * cal.umPerPixel
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function patternToPixels(config: PatternConfigUm, cal: Calibration): PatternPixels {
  return {
    lattice: {
      a: umToPixels(config.lattice.a, cal),
      alpha: config.lattice.alpha,
      b: umToPixels(config.lattice.b, cal),
      beta: config.lattice.beta,
    },
    width: umToPixels(config.width, cal),
    height: umToPixels(config.height, cal),
  }
}

export function patternToYAML(config: PatternConfigUm, cal: Calibration): string {
  const r = (n: number) => Number(n.toFixed(4))
  return [
    "calibration:",
    `  um_per_pixel: ${r(cal.umPerPixel)}`,
    "",
    "lattice:",
    `  a: ${r(config.lattice.a)}  # µm`,
    `  alpha: ${r(radToDeg(config.lattice.alpha))}  # degrees`,
    `  b: ${r(config.lattice.b)}  # µm`,
    `  beta: ${r(radToDeg(config.lattice.beta))}  # degrees`,
    "",
    `width: ${r(config.width)}  # µm`,
    `height: ${r(config.height)}  # µm`,
    "",
  ].join("\n")
}


export function parseYAMLConfig(text: string): { pattern: PatternConfigUm; calibration?: Calibration } {
  // Simple parser for our flat YAML format — strips comments, extracts key: value pairs
  const vals: Record<string, number> = {}
  const lines = text.split("\n")
  const stack: string[] = []

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trimEnd()
    if (!line.trim()) continue

    const indent = line.search(/\S/)
    // Pop stack to match indent level (2 spaces per level)
    while (stack.length > indent / 2) stack.pop()

    const match = line.trim().match(/^(\w+):\s*(.*)$/)
    if (!match) continue

    const [, key, value] = match
    if (value) {
      const path = [...stack, key].join(".")
      vals[path] = parseFloat(value)
    } else {
      stack.push(key)
    }
  }

  const pattern: PatternConfigUm = {
    lattice: {
      a: vals["lattice.a"] ?? 75,
      alpha: degToRad(vals["lattice.alpha"] ?? 0),
      b: vals["lattice.b"] ?? 75,
      beta: degToRad(vals["lattice.beta"] ?? 90),
    },
    width: vals["width"] ?? vals["square_size"] ?? 25,
    height: vals["height"] ?? vals["square_size"] ?? 25,
  }

  const calibration = vals["calibration.um_per_pixel"] != null
    ? { umPerPixel: vals["calibration.um_per_pixel"] }
    : undefined

  return { pattern, calibration }
}
