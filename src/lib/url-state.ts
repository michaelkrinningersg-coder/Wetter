import { useCallback, useEffect, useState } from 'react'

/**
 * Keep a piece of view state in the URL's query string.
 *
 * Until now nothing in this app could be linked: every visitor landed on the
 * same opening view, and "look at the July 2003 heatmap" had to be described in
 * words. The state lived in React and nowhere else.
 *
 * Everything here works on the query string of the current path, never on the
 * path itself. That matters for GitHub Pages, which serves files and has no
 * rewrite rule to fall back on — `/Wetter/?bereich=air` is still a request for
 * `/Wetter/`, while `/Wetter/air` would be a 404.
 *
 * Writes replace the history entry rather than pushing one, so turning a
 * dropdown does not bury the previous page under twenty steps of back button.
 * The one exception is the tab itself, which is a real navigation and pushes —
 * see `useUrlState`'s `push` option.
 */

/** Params that survive a tab change; everything else belongs to one view. */
export const GLOBAL_PARAMS = ['bereich', 'station', 'jahr', 'monat']

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  // Back and forward have to move the app, otherwise the URL and the view drift
  // apart and the address bar starts lying.
  window.addEventListener('popstate', notify)
}

function currentParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}

function apply(params: URLSearchParams, push: boolean) {
  if (typeof window === 'undefined') return
  const query = params.toString()
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`

  if (push) window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

export function readParam(key: string): string | null {
  return currentParams().get(key)
}

/**
 * Write one parameter.
 *
 * Reads the live query string on every call rather than holding a copy, so two
 * components writing different keys in the same tick do not overwrite each
 * other's work.
 */
export function writeParam(key: string, value: string | null, { push = false } = {}) {
  const params = currentParams()
  if (value === null || value === '') params.delete(key)
  else params.set(key, value)
  apply(params, push)
}

/**
 * Switch tab and drop the parameters that belonged to the previous one.
 *
 * Without this the query string accumulates: a visitor who looked at ozone and
 * then moved on to pollen would carry `&groesse=o3` around for the rest of the
 * session, and would paste it into a link where it means nothing.
 */
export function setTabParam(tab: string) {
  const params = currentParams()
  for (const key of [...params.keys()]) {
    if (!GLOBAL_PARAMS.includes(key)) params.delete(key)
  }
  params.set('bereich', tab)
  apply(params, true)
  notify()
}

/**
 * A state value mirrored in the query string.
 *
 * `allowed` guards against a hand-edited or stale URL: an unknown value falls
 * back to the default silently rather than putting the view into a state its
 * data does not cover. `null` means "parameter absent" — several views use that
 * to mean "whatever the server considers the default", and forcing them to
 * spell it out in the URL would make every link longer for no gain.
 */
export function useUrlState<T extends string>(
  key: string,
  fallback: T,
  options?: { allowed?: readonly T[]; push?: boolean },
): [T, (value: T) => void]

export function useUrlState<T extends string>(
  key: string,
  fallback: T | null,
  options?: { allowed?: readonly T[]; push?: boolean },
): [T | null, (value: T | null) => void]

export function useUrlState<T extends string>(
  key: string,
  fallback: T | null,
  options: { allowed?: readonly T[]; push?: boolean } = {},
): [T | null, (value: T | null) => void] {
  const { allowed, push = false } = options

  const parse = useCallback(
    (raw: string | null): T | null => {
      if (raw === null) return fallback
      if (allowed && !allowed.includes(raw as T)) return fallback
      return raw as T
    },
    // `allowed` is a module-level constant in every call site; listing it would
    // re-create the parser on each render for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fallback],
  )

  const [value, setValue] = useState<T | null>(() => parse(readParam(key)))

  useEffect(() => {
    const listener = () => setValue(parse(readParam(key)))
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [key, parse])

  const update = useCallback(
    (next: T | null) => {
      setValue(next)
      writeParam(key, next, { push })
    },
    [key, push],
  )

  return [value, update]
}

/** The same, for a value that is a number in the view but a string in the URL. */
export function useUrlNumber(
  key: string,
  fallback: number,
  options: { min?: number; max?: number } = {},
): [number, (value: number) => void] {
  const { min, max } = options

  const parse = useCallback(
    (raw: string | null): number => {
      if (raw === null) return fallback
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) return fallback
      if (min !== undefined && parsed < min) return fallback
      if (max !== undefined && parsed > max) return fallback
      return parsed
    },
    [fallback, min, max],
  )

  const [value, setValue] = useState<number>(() => parse(readParam(key)))

  useEffect(() => {
    const listener = () => setValue(parse(readParam(key)))
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [key, parse])

  const update = useCallback(
    (next: number) => {
      setValue(next)
      writeParam(key, String(next))
    },
    [key],
  )

  return [value, update]
}

/**
 * A list of values, comma-separated in the URL.
 *
 * Used by the region comparison, where the selection is genuinely a set and
 * repeating the key ten times would make the link unreadable.
 */
export function useUrlList(
  key: string,
  fallback: string[] | null,
): [string[] | null, (value: string[] | null) => void] {
  const parse = useCallback(
    (raw: string | null): string[] | null => {
      if (raw === null) return fallback
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
      return parts.length > 0 ? parts : fallback
    },
    [fallback],
  )

  const [value, setValue] = useState<string[] | null>(() => parse(readParam(key)))

  useEffect(() => {
    const listener = () => setValue(parse(readParam(key)))
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [key, parse])

  const update = useCallback(
    (next: string[] | null) => {
      setValue(next)
      writeParam(key, next === null || next.length === 0 ? null : next.join(','))
    },
    [key],
  )

  return [value, update]
}
