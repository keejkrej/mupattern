import { Store } from "@tanstack/store"

/**
 * Create a TanStack Store that auto-persists to sessionStorage.
 */
export function createPersistedStore<T>(
  key: string,
  defaultState: T,
  options?: {
    serialize?: (state: T) => unknown
    deserialize?: (raw: unknown) => T
    debounceMs?: number
  }
): Store<T> {
  const serialize = options?.serialize ?? ((s: T) => s)
  const deserialize = options?.deserialize ?? ((r: unknown) => r as T)
  const debounceMs = options?.debounceMs ?? 300

  let initial = defaultState
  try {
    const raw = sessionStorage.getItem(key)
    if (raw !== null) {
      initial = deserialize(JSON.parse(raw))
    }
  } catch {
    // use default
  }

  const store = new Store<T>(initial)

  let timer: ReturnType<typeof setTimeout> | null = null
  store.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        sessionStorage.setItem(key, JSON.stringify(serialize(store.state)))
      } catch {
        // storage full or unavailable
      }
    }, debounceMs)
  })

  return store
}
