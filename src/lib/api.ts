import { useCallback, useEffect, useState } from 'react'

import { staticPath } from './static-path'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * True for a build meant for static hosting, where there is no API to talk to
 * and every answer was written to a file at build time.
 */
export const STATIC = import.meta.env.VITE_STATIC === '1'

/** Where a request actually goes. */
export function resolve(path: string): string {
  if (!STATIC) return path
  // BASE_URL carries the repository subpath a Pages site lives under.
  return `${import.meta.env.BASE_URL}${staticPath(path)}`
}

/**
 * Every endpoint in the original app used the same `fetch(...); if (!res.ok)
 * throw` boilerplate but only ever surfaced a generic German message — the
 * server's own error text was discarded. This keeps it.
 */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(resolve(path), { signal, headers: { Accept: 'application/json' } })

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body?.error ?? ''
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail || `Server antwortete mit HTTP ${res.status}.`, res.status)
  }

  return (await res.json()) as T
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * Data-fetching hook used by every tab.
 *
 * Fixes two bugs that every component in the original app shared:
 *  - no request cancellation, so switching stations quickly let a stale
 *    response overwrite the fresh one (last-response-wins race);
 *  - `setState` after unmount, which React logs as a warning and which under
 *    StrictMode's double-effect fired on every single mount.
 */
export function useApi<T>(path: string | null, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (path === null) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    apiGet<T>(path, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setError(
          err instanceof Error
            ? err.message
            : 'Ein unbekannter Fehler ist aufgetreten.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps])

  return { data, loading, error, reload }
}
