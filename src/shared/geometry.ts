import type { LabelDesign } from './schema'
import { PT_TO_MM } from './units'

// Estimate how far text extends beyond the label's top and bottom edges (mm).
// Used to tighten placement bounds so text stays within the page.
export function textOverhang(ld: LabelDesign): { top: number; bottom: number } {
  let top = 0, bottom = 0
  for (const b of ld.qrBlocks) {
    if (!b.showText) continue
    const textH = b.fontSize * PT_TO_MM * 1.2  // × line-height
    if (b.textPosition === 'below') {
      const over = b.yMm + b.sizeMm + b.textOffsetMm + textH - ld.heightMm
      if (over > 0) bottom = Math.max(bottom, over)
    } else {
      const over = -(b.yMm - b.textOffsetMm - textH)
      if (over > 0) top = Math.max(top, over)
    }
  }
  return { top, bottom }
}
