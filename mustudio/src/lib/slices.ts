/**
 * Parse slice expressions like:
 * - "all"
 * - "1,3"
 * - "0:10:2"
 * - ":-1"
 *
 * Semantics mirror muapplication/common/slices.py.
 */
export function parseSliceString(input: string, length: number): number[] {
  const s = input.trim()
  if (s.toLowerCase() === "all") {
    return Array.from({ length }, (_, i) => i)
  }

  const indices = new Set<number>()
  const segments = s.split(",")
  const parseInteger = (value: string, segment: string): number => {
    if (!/^[+-]?\d+$/.test(value)) {
      throw new Error(`Invalid slice segment: ${JSON.stringify(segment)}`)
    }
    return Number.parseInt(value, 10)
  }

  for (const rawSegment of segments) {
    const segment = rawSegment.trim()
    if (!segment) continue

    if (segment.includes(":")) {
      const parts = segment.split(":").map((p) => {
        const trimmed = p.trim()
        if (!trimmed) return null
        return parseInteger(trimmed, segment)
      })

      if (parts.length > 3) {
        throw new Error(`Invalid slice segment: ${JSON.stringify(segment)}`)
      }

      const startRaw = parts[0] ?? null
      const stopRaw = parts[1] ?? null
      const stepRaw = parts[2] ?? null

      if (stepRaw === 0) {
        throw new Error(`Slice step cannot be zero: ${JSON.stringify(segment)}`)
      }

      const step = stepRaw ?? 1
      let start: number
      let stop: number

      if (step > 0) {
        if (startRaw == null) {
          start = 0
        } else {
          start = startRaw < 0 ? startRaw + length : startRaw
          start = Math.min(Math.max(start, 0), length)
        }

        if (stopRaw == null) {
          stop = length
        } else {
          stop = stopRaw < 0 ? stopRaw + length : stopRaw
          stop = Math.min(Math.max(stop, 0), length)
        }

        for (let i = start; i < stop; i += step) {
          indices.add(i)
        }
      } else {
        if (startRaw == null) {
          start = length - 1
        } else {
          start = startRaw < 0 ? startRaw + length : startRaw
          if (start < 0) start = -1
          if (start >= length) start = length - 1
        }

        if (stopRaw == null) {
          stop = -1
        } else {
          stop = stopRaw < 0 ? stopRaw + length : stopRaw
          if (stop < 0) stop = -1
          if (stop >= length) stop = length - 1
        }

        for (let i = start; i > stop; i += step) {
          if (i >= 0 && i < length) {
            indices.add(i)
          }
        }
      }
      continue
    }

    const idx = parseInteger(segment, segment)
    if (idx < -length || idx >= length) {
      throw new Error(`Index ${idx} out of range for length ${length}`)
    }
    indices.add(((idx % length) + length) % length)
  }

  const result = [...indices].sort((a, b) => a - b)
  if (result.length === 0) {
    throw new Error(`Slice string ${JSON.stringify(input)} produced no indices`)
  }
  return result
}

/**
 * Parse a slice expression against concrete position values (e.g. 140,150,156),
 * returning selected indices in the provided values array.
 *
 * Example:
 * values=[140,150,156], input="140" -> [0]
 * values=[140,150,156], input="140:157:10" -> [0,1]
 */
export function parseSliceStringOverValues(input: string, values: number[]): number[] {
  if (values.length === 0) return []
  if (input.trim().toLowerCase() === "all") {
    return Array.from({ length: values.length }, (_, i) => i)
  }

  const maxValue = Math.max(...values)
  const selectedValues = new Set(parseSliceString(input, maxValue + 1))
  const selectedIndices = values
    .map((value, index) => (selectedValues.has(value) ? index : -1))
    .filter((index) => index >= 0)

  if (selectedIndices.length === 0) {
    throw new Error(`Slice string ${JSON.stringify(input)} produced no positions`)
  }
  return selectedIndices
}
