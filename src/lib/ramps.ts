/**
 * The colour ramps, shared by every view that encodes a number as a colour.
 *
 * These are the one set of colours that could not become CSS custom
 * properties: they are picked by index from an array, and thirteen variables to
 * express two gradients would be worse than two arrays.
 *
 * The light versions are not the dark ones adjusted. The dark diverging ramp
 * passes through 86 % lightness in its middle, which is a legible "near
 * average" on near black and an invisible dot on near white — so the light
 * ramp runs darker throughout and puts its neutral at 78 %, still clearly
 * lighter than either extreme without vanishing into the page.
 */

/** Cold to warm, through a desaturated middle so the extremes carry the eye. */
const DIVERGING_DARK = [
  'oklch(55% 0.16 255)',
  'oklch(70% 0.12 235)',
  'oklch(82% 0.05 220)',
  'oklch(86% 0.04 90)',
  'oklch(80% 0.13 60)',
  'oklch(70% 0.18 35)',
  'oklch(56% 0.20 25)',
]

const DIVERGING_LIGHT = [
  'oklch(42% 0.17 255)',
  'oklch(58% 0.14 235)',
  'oklch(72% 0.07 220)',
  'oklch(78% 0.05 90)',
  'oklch(68% 0.15 60)',
  'oklch(56% 0.19 35)',
  'oklch(44% 0.20 25)',
]

/** Dry to wet. */
const SEQUENTIAL_DARK = [
  'oklch(72% 0.03 230)',
  'oklch(74% 0.08 225)',
  'oklch(70% 0.12 220)',
  'oklch(62% 0.15 235)',
  'oklch(52% 0.17 250)',
  'oklch(42% 0.17 265)',
]

const SEQUENTIAL_LIGHT = [
  'oklch(84% 0.03 230)',
  'oklch(76% 0.08 225)',
  'oklch(66% 0.13 220)',
  'oklch(56% 0.16 235)',
  'oklch(46% 0.17 250)',
  'oklch(36% 0.16 265)',
]

/**
 * Old to recent, for encoding time rather than temperature.
 *
 * Deliberately not the diverging ramp: blue-to-red would read as cold-to-warm,
 * and a calendar of record years is about *when*, not about how warm. A hue
 * rotation from slate through green to gold rises in both lightness and
 * saturation, so it stays ordered even where the page is printed in grey.
 */
const TIME_DARK = [
  'oklch(45% 0.03 260)',
  'oklch(55% 0.06 220)',
  'oklch(64% 0.09 165)',
  'oklch(72% 0.12 115)',
  'oklch(80% 0.15 90)',
  'oklch(87% 0.17 78)',
]

const TIME_LIGHT = [
  'oklch(84% 0.03 260)',
  'oklch(75% 0.06 220)',
  'oklch(66% 0.10 165)',
  'oklch(59% 0.13 115)',
  'oklch(52% 0.16 90)',
  'oklch(45% 0.17 66)',
]

export const RAMPS = {
  dark: { diverging: DIVERGING_DARK, sequential: SEQUENTIAL_DARK, time: TIME_DARK },
  light: { diverging: DIVERGING_LIGHT, sequential: SEQUENTIAL_LIGHT, time: TIME_LIGHT },
}

/** Pick a colour from a ramp for a fraction between 0 and 1. */
export function ramp(colours: string[], t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const index = Math.min(colours.length - 1, Math.floor(clamped * colours.length))
  return colours[index]!
}
