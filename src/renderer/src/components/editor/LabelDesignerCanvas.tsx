import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Group, Image as KImage, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { useTransformHUD } from '../../hooks/useTransformHUD'
import { useQrImage } from '../../hooks/useQrImage'
import { useTransformerAttach } from '../../hooks/useTransformerAttach'
import { useCanvasScroll } from '../../hooks/useCanvasScroll'
import { CANVAS_MARGIN, PT_TO_CANVAS_SCALE } from '../../constants/editor'
import { Rulers, RULER_SIZE } from './Rulers'
import { AlignToolbar } from './AlignToolbar'
import { mmToKonva, konvaToMm, PT_TO_MM } from '../../../../shared/units'
import { previewPayloadFromConfig } from '../../../../shared/numberFormat'
import type { QrBlock } from '../../../../shared/schema'

// ── Rotation-aware content bounds ─────────────────────────────────────────────
// Computes the axis-aligned bounding box of a QrBlock's content (QR image + text)
// after the block is rotated around its top-left corner (Group origin).
// Returns offsets from the origin in Label-local mm — used for drag/transform clamping.
function contentBoundsAfterRotation(
  sp: number,     // QR size in Konva px
  textH: number,  // total text height in Konva px (may be multi-line; use textRef.current.height() for wrapText)
  tp: number,     // text offset in Konva px
  textX: number,       // text left x in Group-local px (single-line)
  textActualW: number, // actual rendered text width in Konva px
  showText: boolean,
  wrapText: boolean,
  textPosition: 'above' | 'below',
  rotDeg: number,
  zoom: number
): { minXMm: number; maxXMm: number; minYMm: number; maxYMm: number } {
  // Content box in Group-local pixels (unrotated)
  let cMinX = 0, cMaxX = sp, cMinY = 0, cMaxY = sp
  if (showText) {
    const tX = wrapText ? 0 : textX
    const tW = wrapText ? sp : textActualW
    cMinX = Math.min(cMinX, tX)
    cMaxX = Math.max(cMaxX, tX + tW)
    if (textPosition === 'below') cMaxY = sp + tp + textH
    else                          cMinY = -(tp + textH)
  }
  // Rotate the four corners of the content box around the Group origin (0,0)
  const θ = rotDeg * Math.PI / 180
  const c = Math.cos(θ), s = Math.sin(θ)
  const rot = (x: number, y: number) => [x * c - y * s, x * s + y * c] as const
  const corners = [
    rot(cMinX, cMinY), rot(cMaxX, cMinY),
    rot(cMinX, cMaxY), rot(cMaxX, cMaxY),
  ]
  const toMm = (px: number) => konvaToMm(px, zoom)
  return {
    minXMm: toMm(Math.min(...corners.map(([x]) => x))),
    maxXMm: toMm(Math.max(...corners.map(([x]) => x))),
    minYMm: toMm(Math.min(...corners.map(([, y]) => y))),
    maxYMm: toMm(Math.max(...corners.map(([, y]) => y))),
  }
}

// ── QrBlock Node ──────────────────────────────────────────────────────────────
interface QrBlockNodeProps {
  block: QrBlock
  zoom: number
  payload: string
  // Label bounds in mm — for clamping
  labelWMm: number
  labelHMm: number
  // Layer offset in Stage-absolute px — needed for dragBoundFunc
  layerOffsetX: number
  layerOffsetY: number
  isSelected: boolean
  showTransformer: boolean
  onRef: (id: string, node: Konva.Group | null) => void
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void
  onDragStart: (id: string) => void
  onDragEnd: (id: string, xMm: number, yMm: number) => void
  onMultiDragMove: (id: string) => void
  onTransformEnd: (id: string, sizeMm: number, rotDeg: number, xMm: number, yMm: number, fontSize: number) => void
  onDragMove: (xPx: number, yPx: number, mx: number, my: number) => void
  onTransformChange: (sizePx: number, origMm: number, rot: number, mx: number, my: number) => void
  onInteractEnd: () => void
  snapDeg: (deg: number) => number
}

function QrBlockNode({
  block, zoom, payload,
  labelWMm, labelHMm,
  layerOffsetX, layerOffsetY,
  isSelected, showTransformer,
  onRef, onSelect, onDragStart, onDragEnd, onMultiDragMove,
  onTransformEnd, onDragMove, onTransformChange, onInteractEnd, snapDeg,
}: QrBlockNodeProps) {
  const groupRef = useRef<Konva.Group>(null)

  // Register group ref with parent for multi-drag coordination
  useEffect(() => {
    if (groupRef.current) onRef(block.id, groupRef.current)
    return () => { onRef(block.id, null) }
  }, []) // eslint-disable-line
  const trRef    = useRef<Konva.Transformer>(null)
  const textRef  = useRef<Konva.Text>(null)
  const qrImg = useQrImage(payload)
  const [textX, setTextX] = useState(0)
  // Actual rendered text height in Konva px. For wrapText=true the text can span multiple
  // lines, so fp (1 line) underestimates. We measure via textRef.current.height() after layout.
  const [textActualH, setTextActualH] = useState(() => Math.max(6, block.fontSize * zoom * PT_TO_CANVAS_SCALE))
  const toK = (mm: number) => mmToKonva(mm, zoom)

  useTransformerAttach(showTransformer, trRef, groupRef)

  const sp = toK(block.sizeMm)
  const fp = Math.max(6, block.fontSize * zoom * PT_TO_CANVAS_SCALE)
  const tp = toK(block.textOffsetMm)

  useLayoutEffect(() => {
    if (!block.showText || block.wrapText || !textRef.current) { setTextX(0); return }
    const actualW = textRef.current.getTextWidth()
    setTextX((sp - actualW) / 2)
  }, [block.showText, block.wrapText, payload, fp, block.fontFamily, sp])

  useLayoutEffect(() => {
    // For wrapText=true the Konva Text auto-sizes its height to fit all lines.
    // Measure it after layout so bounds and y-position are always exact.
    if (!block.showText || !block.wrapText || !textRef.current) { setTextActualH(fp); return }
    setTextActualH(textRef.current.height())
  }, [block.showText, block.wrapText, payload, fp, block.fontFamily, sp])

  const textActualW = !block.wrapText && textRef.current ? textRef.current.getTextWidth() : sp
  const cb = contentBoundsAfterRotation(
    sp, textActualH, tp, textX, textActualW,
    block.showText, block.wrapText, block.textPosition,
    block.rotationDeg, zoom
  )
  const minAbsX = layerOffsetX + toK(Math.max(0, -cb.minXMm))
  const maxAbsX = layerOffsetX + toK(Math.max(0, labelWMm - cb.maxXMm))
  const minAbsY = layerOffsetY + toK(Math.max(0, -cb.minYMm))
  const maxAbsY = layerOffsetY + toK(Math.max(0, labelHMm - cb.maxYMm))

  return (
    <>
      <Group
        ref={groupRef}
        x={toK(block.xMm)} y={toK(block.yMm)}
        rotation={block.rotationDeg}
        draggable
        dragBoundFunc={pos => ({
          x: Math.max(minAbsX, Math.min(maxAbsX, pos.x)),
          y: Math.max(minAbsY, Math.min(maxAbsY, pos.y)),
        })}
        onClick={onSelect} onTap={onSelect}
        onDragStart={() => onDragStart(block.id)}
        onDragMove={e => {
          onDragMove(e.target.x(), e.target.y(),
            (e.evt as MouseEvent).clientX, (e.evt as MouseEvent).clientY)
          onMultiDragMove(block.id)
        }}
        onDragEnd={e => {
          const xMm = konvaToMm(e.target.x(), zoom)
          const yMm = konvaToMm(e.target.y(), zoom)
          onDragEnd(block.id, xMm, yMm)
          onInteractEnd()
        }}
        onTransform={e => {
          const n = e.target as Konva.Group
          const mx = (e.evt as MouseEvent).clientX, my = (e.evt as MouseEvent).clientY
          onTransformChange(sp * n.scaleX(), block.sizeMm, n.rotation(), mx, my)
        }}
        onTransformEnd={e => {
          const n = e.target as Konva.Group
          const rawSz = Math.max(5, block.sizeMm * n.scaleX())
          // Reserve space for text (above or below) so it never overflows the label.
          // textActualH is measured from the last render, accurate for both single and multi-line.
          const textHMm = block.showText ? block.textOffsetMm + konvaToMm(textActualH, zoom) : 0
          const clampedSz = Math.min(rawSz, labelWMm, Math.max(1, labelHMm - textHMm))
          // Scale fontSize proportionally, clamped to a readable minimum
          const scale = clampedSz / block.sizeMm
          const newFontSize = Math.max(4, Math.round(block.fontSize * scale * 10) / 10)
          const rotDeg = snapDeg(((n.rotation() % 360) + 360) % 360) % 360
          const newSp = toK(clampedSz)
          const tW = !block.wrapText && textRef.current ? textRef.current.getTextWidth() : newSp
          const newTextX = block.wrapText ? 0 : (newSp - tW) / 2
          // End text height: font and QR scale by the same factor, so line count is preserved.
          // For single-line recompute from newFontSize; for multi-line scale textActualH directly.
          const endTextH = block.showText
            ? (block.wrapText ? textActualH * scale : Math.max(6, newFontSize * zoom * 1.333))
            : fp
          const endCb = contentBoundsAfterRotation(
            newSp, endTextH, tp, newTextX, tW,
            block.showText, block.wrapText, block.textPosition, rotDeg, zoom
          )
          const xMm = Math.max(-endCb.minXMm, Math.min(labelWMm - endCb.maxXMm, konvaToMm(n.x(), zoom)))
          const yMm = Math.max(-endCb.minYMm, Math.min(labelHMm - endCb.maxYMm, konvaToMm(n.y(), zoom)))
          n.scaleX(1); n.scaleY(1)
          trRef.current?.forceUpdate()  // recalculate Transformer bounds immediately after scale reset
          onTransformEnd(block.id, clampedSz, rotDeg, xMm, yMm, newFontSize)
          onInteractEnd()
        }}
      >
        {qrImg
          ? <KImage image={qrImg} x={0} y={0} width={sp} height={sp} />
          : <Rect x={0} y={0} width={sp} height={sp} fill="#eee" stroke="#bbb" strokeWidth={1} />}
        {block.showText && (
          <Text
            ref={textRef}
            text={payload}
            x={block.wrapText ? 0 : textX}
            y={block.textPosition === 'below' ? sp + tp : -(tp + textActualH)}
            width={block.wrapText ? sp : undefined}
            align={block.wrapText ? 'center' : 'left'}
            fontSize={fp} fontFamily={block.fontFamily} fill="#000"
            wrap={block.wrapText ? 'word' : 'none'}
            listening={false}
          />
        )}
        {/* Border: solid purple when selected, faint dashed when not */}
        <Rect x={0} y={0} width={sp} height={sp}
          stroke={isSelected ? '#7c6af7' : 'rgba(124,106,247,0.4)'}
          strokeWidth={isSelected ? 1.5 : 1}
          dash={isSelected ? undefined : [3, 2]}
          fill="transparent" listening={false} />
      </Group>

      {showTransformer && (
        <Transformer ref={trRef} keepRatio rotateEnabled
          enabledAnchors={['top-left','top-right','bottom-left','bottom-right']}
          borderStroke="#7c6af7" anchorStroke="#7c6af7" anchorFill="#fff"
          rotateAnchorOffset={24}
          boundBoxFunc={(oldBox, newBox) => {
            // Enforce label boundaries during live scaling (all rotations, all text modes).
            //
            // When scaled by factor k (newBox.width = sp·k), both QR and fontSize scale
            // proportionally, so:
            //   content_w(k) = sp·k
            //   content_h(k) = sp·k + tp + textH·k  =  k·(sp + textH) + tp
            //   (tp = textOffsetMm in px, fixed; textH scales with font → ×k)
            //   (same span for text 'above' and 'below' — direction doesn't affect size)
            //
            // Axis-aligned bounding box after rotation by θ:
            //   rotated_w = content_w·c + content_h·s
            //             = k·(sp·c + (sp+textH)·s) + tp·s  ≤  labelW
            //   rotated_h = content_w·s + content_h·c
            //             = k·(sp·s + (sp+textH)·c) + tp·c  ≤  labelH
            //
            // Solving for k, then max new sp = sp·k:
            //   maxSpFromW = sp · (labelW − tp·s) / (sp·(c+s) + textH·s)
            //   maxSpFromH = sp · (labelH − tp·c) / (sp·(c+s) + textH·c)
            const rotRad = newBox.rotation * Math.PI / 180
            const c = Math.abs(Math.cos(rotRad))
            const s = Math.abs(Math.sin(rotRad))
            const tpPx = block.showText ? tp : 0
            const thPx = block.showText ? textActualH : 0
            const labelWPx = toK(labelWMm)
            const labelHPx = toK(labelHMm)
            const denomW = sp * (c + s) + thPx * s
            const denomH = sp * (c + s) + thPx * c
            const maxSpFromW = denomW > 1e-9 ? sp * (labelWPx - tpPx * s) / denomW : labelWPx
            const maxSpFromH = denomH > 1e-9 ? sp * (labelHPx - tpPx * c) / denomH : labelHPx
            const minSp = toK(5)
            const maxSp = Math.max(minSp, Math.min(maxSpFromW, maxSpFromH))
            if (newBox.width > maxSp || newBox.width < minSp) return oldBox
            return newBox
          }}
        />
      )}
    </>
  )
}

// ── LabelDesignerCanvas ───────────────────────────────────────────────────────
export function LabelDesignerCanvas() {
  const {
    template, zoom, selectedIds,
    setSelected, setSelectedIds, toggleSelected,
    updateQrBlock, showRuler,
    labelScrollPos, setLabelScrollPos,
  } = useTemplateStore(useShallow(s => ({
    template: s.template, zoom: s.zoom, selectedIds: s.selectedIds,
    setSelected: s.setSelected, setSelectedIds: s.setSelectedIds,
    toggleSelected: s.toggleSelected,
    updateQrBlock: s.updateQrBlock, showRuler: s.showRuler,
    labelScrollPos: s.labelScrollPos, setLabelScrollPos: s.setLabelScrollPos,
  })))

  // Multi-drag: refs to all QrBlock Group nodes, and drag start positions
  const blockGroupRefs  = useRef<Map<string, Konva.Group>>(new Map())
  const multiDragStart  = useRef<Map<string, { x: number; y: number }> | null>(null)

  const handleBlockRef = useCallback((id: string, node: Konva.Group | null) => {
    if (node) blockGroupRefs.current.set(id, node)
    else blockGroupRefs.current.delete(id)
  }, [])

  const handleBlockDragStart = useCallback((leaderId: string) => {
    const ids = useTemplateStore.getState().selectedIds
    if (!ids.includes(leaderId) || ids.length <= 1) { multiDragStart.current = null; return }
    const starts = new Map<string, { x: number; y: number }>()
    for (const id of ids) {
      const node = blockGroupRefs.current.get(id)
      if (node) starts.set(id, { x: node.x(), y: node.y() })
    }
    multiDragStart.current = starts
  }, [])

  const handleBlockMultiDragMove = useCallback((leaderId: string) => {
    if (!multiDragStart.current) return
    const leaderNode  = blockGroupRefs.current.get(leaderId)
    const leaderStart = multiDragStart.current.get(leaderId)
    if (!leaderNode || !leaderStart) return
    const dx = leaderNode.x() - leaderStart.x
    const dy = leaderNode.y() - leaderStart.y
    for (const [id, start] of multiDragStart.current) {
      if (id === leaderId) continue
      const node = blockGroupRefs.current.get(id)
      if (node) { node.x(start.x + dx); node.y(start.y + dy) }
    }
    leaderNode.getLayer()?.batchDraw()
  }, [])

  const handleBlockDragEnd = useCallback((leaderId: string, leaderXMm: number, leaderYMm: number) => {
    if (!multiDragStart.current) {
      updateQrBlock(leaderId, { xMm: leaderXMm, yMm: leaderYMm })
      return
    }
    const leaderNode  = blockGroupRefs.current.get(leaderId)
    const leaderStart = multiDragStart.current.get(leaderId)
    if (!leaderNode || !leaderStart) { multiDragStart.current = null; return }
    const z  = useTemplateStore.getState().zoom
    const dx = leaderNode.x() - leaderStart.x
    const dy = leaderNode.y() - leaderStart.y
    const updates = [...multiDragStart.current.entries()].map(([id, start]) => ({
      id,
      xMm: konvaToMm(start.x + dx, z),
      yMm: konvaToMm(start.y + dy, z),
    }))
    useTemplateStore.getState().updateManyQrBlocks(updates)
    multiDragStart.current = null
  }, [updateQrBlock])
  const { showDrag, showScale, showRotate, hide } = useTransformHUD()

  const scrollRef = useRef<HTMLDivElement>(null)
  const stageRef  = useRef<Konva.Stage>(null)
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })

  // Rubber-band selection state
  const [selBox, setSelBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const selBoxRef     = useRef(selBox)
  const isRubberBanding = useRef(false)

  const { labelDesign, unit, printConfig } = template
  const payload = previewPayloadFromConfig(printConfig)
  const toK = useCallback((mm: number) => mmToKonva(mm, zoom), [zoom])

  const contentW = toK(labelDesign.widthMm)
  const contentH = toK(labelDesign.heightMm)
  const rl = showRuler ? RULER_SIZE : 0

  const contentX = CANVAS_MARGIN
  const contentY = CANVAS_MARGIN

  const totalW = Math.max(containerSize.w - rl, contentW + CANVAS_MARGIN * 2)
  const totalH = Math.max(containerSize.h - rl, contentH + CANVAS_MARGIN * 2)
  const rulerOriginX = contentX - scroll.x + rl
  const rulerOriginY = contentY - scroll.y + rl

  const snapRotDeg = template.grid.snapRotationDeg
  const snapDeg = (deg: number) => snapRotDeg ? Math.round(deg / snapRotDeg) * snapRotDeg : deg

  useEffect(() => {
    const el = scrollRef.current; if (!el) return
    const ro = new ResizeObserver(e => {
      const r = e[0].contentRect
      setContainerSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      // Save scroll position on unmount so mode-switch (label↔sheet) restores correctly.
      // Without this, the zoom re-centering effect that fires when mode changes can
      // overwrite the saved position before the component finishes unmounting.
      if (scrollRef.current) setLabelScrollPos(scrollRef.current.scrollLeft, scrollRef.current.scrollTop)
    }
  }, []) // eslint-disable-line

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      setScroll({ x: el.scrollLeft, y: el.scrollTop })
      setLabelScrollPos(el.scrollLeft, el.scrollTop)
    }
  }, [setLabelScrollPos])

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return

      const s = useTemplateStore.getState()
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { s.undo(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { s.redo(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        s.setSelectedIds(s.template.labelDesign.qrBlocks.map(b => b.id)); e.preventDefault()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { s.copySelected(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { s.pasteClipboard(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && s.selectedIds.length > 0) {
        s.duplicateSelectedQrBlocks(); e.preventDefault()
      }
      if (e.key === 'Delete' && s.selectedIds.length > 0) s.deleteSelectedQrBlocks()
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) { s.zoomIn(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.code === 'NumpadSubtract')) { s.zoomOut(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Numpad0')) { s.resetZoom(); e.preventDefault() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Rubber-band global mouse handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isRubberBanding.current || !stageRef.current) return
      const rect = stageRef.current.container().getBoundingClientRect()
      const layerX = e.clientX - rect.left - contentX
      const layerY = e.clientY - rect.top  - contentY
      const newBox = selBoxRef.current ? { ...selBoxRef.current, x2: layerX, y2: layerY } : null
      selBoxRef.current = newBox
      setSelBox(newBox)
    }
    const onMouseUp = () => {
      if (!isRubberBanding.current) return
      isRubberBanding.current = false
      const box = selBoxRef.current
      selBoxRef.current = null
      setSelBox(null)
      if (!box) return
      const { x1, y1, x2, y2 } = box
      const rx1 = Math.min(x1, x2), rx2 = Math.max(x1, x2)
      const ry1 = Math.min(y1, y2), ry2 = Math.max(y1, y2)
      if (rx2 - rx1 < 3 && ry2 - ry1 < 3) { useTemplateStore.getState().setSelectedIds([]); return }
      const s = useTemplateStore.getState()
      const z = s.zoom
      const hits = s.template.labelDesign.qrBlocks.filter(block => {
        const bx1 = mmToKonva(block.xMm, z)
        const bx2 = bx1 + mmToKonva(block.sizeMm, z)
        const by1 = mmToKonva(block.yMm, z)
        const by2 = by1 + mmToKonva(block.sizeMm, z)
        return rx1 < bx2 && rx2 > bx1 && ry1 < by2 && ry2 > by1
      })
      s.setSelectedIds(hits.map(b => b.id))
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [contentX, contentY])

  useCanvasScroll(scrollRef, labelScrollPos, containerSize, zoom)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {selectedIds.length >= 2 && <AlignToolbar />}

      <div style={{ flex: 1, position: 'relative', background: 'var(--canvas-bg)', overflow: 'hidden' }}>
        {showRuler && (
          <Rulers widthMm={labelDesign.widthMm} heightMm={labelDesign.heightMm}
            zoom={zoom} unit={unit} originX={rulerOriginX} originY={rulerOriginY} />
        )}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={e => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault()
              const s = useTemplateStore.getState()
              s.setZoom(Math.round((s.zoom + (e.deltaY > 0 ? -0.1 : 0.1)) * 100) / 100)
            }
          }}
          style={{ position: 'absolute', top: rl, left: rl, right: 0, bottom: 0, overflow: 'auto' }}
        >
          <div style={{ width: totalW, height: totalH, position: 'relative' }}>
            <Stage ref={stageRef} width={totalW} height={totalH}
              style={{ position: 'absolute', top: 0, left: 0 }}
              onMouseDown={e => {
                if (e.target !== e.target.getStage()) return
                const pos = stageRef.current!.getPointerPosition()!
                const layerX = pos.x - contentX
                const layerY = pos.y - contentY
                isRubberBanding.current = true
                selBoxRef.current = { x1: layerX, y1: layerY, x2: layerX, y2: layerY }
                setSelBox({ x1: layerX, y1: layerY, x2: layerX, y2: layerY })
              }}
            >
              <Layer listening={false}>
                <Rect x={0} y={0} width={totalW} height={totalH} fill="#12121e" />
              </Layer>

              {/* Content layer — its x/y IS the layerOffset we pass to children */}
              <Layer x={contentX} y={contentY}>
                {/* Shadow */}
                <Rect x={3} y={3} width={contentW} height={contentH} fill="rgba(0,0,0,0.2)" listening={false} />
                {/* Label bounding box */}
                <Rect x={0} y={0} width={contentW} height={contentH}
                  fill="white" stroke="#4a4a6a" strokeWidth={1} dash={[4, 3]} listening={false} />

                {labelDesign.qrBlocks.map(block => (
                  <QrBlockNode
                    key={block.id}
                    block={block} zoom={zoom} payload={payload}
                    labelWMm={labelDesign.widthMm} labelHMm={labelDesign.heightMm}
                    layerOffsetX={contentX} layerOffsetY={contentY}
                    isSelected={selectedIds.includes(block.id)}
                    showTransformer={selectedIds.length === 1 && selectedIds[0] === block.id}
                    onRef={handleBlockRef}
                    onSelect={e => {
                      e.cancelBubble = true
                      if ((e.evt as MouseEvent).shiftKey) toggleSelected(block.id)
                      else setSelected(block.id)
                    }}
                    onDragStart={handleBlockDragStart}
                    onMultiDragMove={handleBlockMultiDragMove}
                    onDragMove={showDrag}
                    onTransformChange={(sp, om, rot, mx, my) =>
                      Math.abs(konvaToMm(sp, zoom) / om - 1) < 0.001
                        ? showRotate(rot, mx, my)
                        : showScale(sp, om, mx, my)}
                    onInteractEnd={hide}
                    snapDeg={snapDeg}
                    onDragEnd={handleBlockDragEnd}
                    onTransformEnd={(id, sizeMm, rotationDeg, xMm, yMm, fontSize) =>
                      updateQrBlock(id, { sizeMm, rotationDeg, xMm, yMm, fontSize })}
                  />
                ))}

                {/* Rubber-band selection rectangle */}
                {selBox && (
                  <Rect
                    x={Math.min(selBox.x1, selBox.x2)} y={Math.min(selBox.y1, selBox.y2)}
                    width={Math.abs(selBox.x2 - selBox.x1)} height={Math.abs(selBox.y2 - selBox.y1)}
                    fill="rgba(124,106,247,0.08)" stroke="#7c6af7" strokeWidth={1} dash={[4, 2]}
                    listening={false}
                  />
                )}
              </Layer>
            </Stage>
          </div>
        </div>
      </div>
    </div>
  )
}
