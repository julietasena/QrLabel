import type { LabelDesign, QrBlock } from './schema'
import { PT_TO_MM } from './units'

// Maximum QR size (mm) such that the full content (QR + text) fits within
// [0, labelWMm] × [0, labelHMm].
//
// The content is a rectangle (sizeMm wide, sizeMm+textAddMm tall).
// Its AABB when rotated by θ must fit in the label:
//   sizeMm·(|cos|+|sin|) + textAddMm·|sin| ≤ labelW
//   sizeMm·(|cos|+|sin|) + textAddMm·|cos| ≤ labelH
// Solving for sizeMm:
//   maxSp = min( (labelW − textAddMm·|sin|) / cs,
//                (labelH − textAddMm·|cos|) / cs )
export function maxQrSizeMm(b: QrBlock, labelWMm: number, labelHMm: number): number {
  const θ = (b.rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(θ))
  const sin = Math.abs(Math.sin(θ))
  const textAddMm = b.showText ? b.textOffsetMm + b.fontSize * PT_TO_MM * 1.333 : 0
  const cs = cos + sin
  const maxW = cs > 0 ? (labelWMm - textAddMm * sin) / cs : labelWMm
  const maxH = cs > 0 ? (labelHMm - textAddMm * cos) / cs : labelHMm
  return Math.max(1, Math.min(maxW, maxH))
}

// Computes the valid range for block.xMm / block.yMm so that the entire
// rotated content (QR image + text) stays within [0, labelWMm] × [0, labelHMm].
//
// The block's Group origin is its top-left corner (rotation pivot).
// Text height is approximated as fontSize × PT_TO_MM × 1.333 (Konva line-height).
// For single-line text the approximation is exact; for wrapText the actual height
// may be larger (more lines), making these bounds slightly loose — that is safe
// because the canvas's own onTransformEnd uses measured text height and applies
// tighter clamping before calling updateQrBlock.
export function qrBlockValidBounds(
  b: QrBlock, labelWMm: number, labelHMm: number
): { minXMm: number; maxXMm: number; minYMm: number; maxYMm: number } {
  const sp = b.sizeMm
  const textHMm = b.showText ? b.textOffsetMm + b.fontSize * PT_TO_MM * 1.333 : 0

  // Content box in Group-local mm, unrotated (origin = top-left of QR image)
  const cMinX = 0, cMaxX = sp
  const cMinY = b.showText && b.textPosition === 'above' ? -textHMm : 0
  const cMaxY = b.showText && b.textPosition === 'below' ? sp + textHMm : sp

  // Rotate all four corners of the content box around origin
  const θ = (b.rotationDeg * Math.PI) / 180
  const c = Math.cos(θ), s = Math.sin(θ)
  const rot = (x: number, y: number) => [x * c - y * s, x * s + y * c] as const
  const corners = [
    rot(cMinX, cMinY), rot(cMaxX, cMinY),
    rot(cMinX, cMaxY), rot(cMaxX, cMaxY),
  ]

  // Axis-aligned bounding box of the rotated content (relative to the block origin)
  const rotMinX = Math.min(...corners.map(([x]) => x))
  const rotMaxX = Math.max(...corners.map(([x]) => x))
  const rotMinY = Math.min(...corners.map(([, y]) => y))
  const rotMaxY = Math.max(...corners.map(([, y]) => y))

  // Valid range for the block origin so the whole rotated content stays in label bounds.
  // If the rotated content is larger than the label on an axis, clamp to the left/top edge.
  const minXMm = -rotMinX
  const maxXMm = Math.max(minXMm, labelWMm - rotMaxX)
  const minYMm = -rotMinY
  const maxYMm = Math.max(minYMm, labelHMm - rotMaxY)

  return { minXMm, maxXMm, minYMm, maxYMm }
}

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
