import { useEffect, useState } from 'react'

/**
 * Light and dark, switched by hand.
 *
 * The choice is stored and applied to `<html data-theme>`; every colour in the
 * app is a CSS custom property, so the switch is one attribute and the browser
 * repaints. Dark stays the default — this app was designed dark, and a visitor
 * who wants light says so once.
 *
 * Applied before the first paint by an inline script in `index.html`, not from
 * React: doing it in an effect would render one frame of dark before the light
 * theme lands, and that flash is the whole reason people dislike theme
 * switches.
 */

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'theme'

/** Kept in module scope so several components observing it stay in step. */
const listeners = new Set<(theme: Theme) => void>()

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function setTheme(theme: Theme) {
  if (typeof document === 'undefined') return

  // The attribute is only ever present for light; its absence is the default,
  // which keeps the pre-paint script in `index.html` down to one condition.
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
  else document.documentElement.removeAttribute('data-theme')

  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* storage unavailable — the choice lasts for this page only */
  }

  for (const listener of listeners) listener(theme)
}

/**
 * The active theme, and a setter.
 *
 * Components that compute colours arithmetically — the heatmap, the warming
 * stripes, the map ramps — need to know which theme is active, because a
 * formula tuned for a near-black background produces mud on white. Everything
 * else just uses the CSS variables and never calls this.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setLocal] = useState<Theme>(currentTheme)

  useEffect(() => {
    listeners.add(setLocal)
    // A second tab, or the pre-paint script, may have set it since mount.
    setLocal(currentTheme())
    return () => {
      listeners.delete(setLocal)
    }
  }, [])

  return [theme, setTheme]
}
