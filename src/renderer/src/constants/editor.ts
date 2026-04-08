/** Extra space (px) added around the canvas content on all sides. */
export const CANVAS_MARGIN = 80

/**
 * Factor to convert a font size in points to Konva canvas pixels.
 * Derived from 96 DPI base: 1 pt = 96/72 ≈ 1.333 px.
 * Used with a slight line-height factor so the initial height estimate
 * is close to what Konva measures after layout.
 */
export const PT_TO_CANVAS_SCALE = 1.333
