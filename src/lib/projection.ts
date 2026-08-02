/**
 * Equirectangular, with the longitude axis shrunk by cos(latitude).
 *
 * At Germany's mean latitude of 51° a degree of longitude covers 0.63 of the
 * ground a degree of latitude does. Plotting the raw numbers would stretch the
 * country half again as wide as it is. This is not an equal-area projection —
 * for a strip eight degrees tall the difference is not visible, and anything
 * more elaborate would need a projection library.
 *
 * Shared by every view that puts stations on a map, so a point sits in the same
 * place whichever page drew it.
 */

export interface Bounds {
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export function makeProjection(bounds: Bounds, width: number, height: number) {
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180)
  const stretch = Math.cos(midLat)

  const spanX = (bounds.maxLon - bounds.minLon) * stretch
  const spanY = bounds.maxLat - bounds.minLat
  // One scale for both axes, so the shape stays true rather than filling the box.
  const scale = Math.min(width / spanX, height / spanY)

  const offsetX = (width - spanX * scale) / 2
  const offsetY = (height - spanY * scale) / 2

  return (lat: number, lon: number) => ({
    x: offsetX + (lon - bounds.minLon) * stretch * scale,
    y: offsetY + (bounds.maxLat - lat) * scale,
  })
}
