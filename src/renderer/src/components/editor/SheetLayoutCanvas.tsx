import React, { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react'
import { Stage, Layer, Rect, Group, Image as KImage, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import { useTemplateStore } from '../../store/templateStore'
import { textOverhang } from '../../../../shared/geometry'
import { useShallow } from 'zustand/react/shallow'
import { useTransformHUD } from '../../hooks/useTransformHUD'
import { useQrImage } from '../../hooks/useQrImage'
import { useTransformerAttach } from '../../hooks/useTransformerAttach'
import { useCanvasScroll } from '../../hooks/useCanvasScroll'
import { CANVAS_MARGIN, PT_TO_CANVAS_SCALE } from '../../constants/editor'
import { Rulers, RULER_SIZE } from './Rulers'
import { mmToKonva, konvaToMm } from '../../../../shared/units'
import { getPreviewPayload } from '../../../../shared/numberFormat'
import type { Placement, LabelDesign, QrBlock } from '../../../../shared/schema'
import { AlignToolbar } from './AlignToolbar'

// ── Rotation-aware bounds ─────────────────────────────────────────────────────
//
// When a label (W × H) is placed at (px, py) and rotated θ clockwise around
// its top-left corner, the four corners in Layer-local coords are:
//   TL: (px,        py)
//   TR: (px + W·c,  py + W·s)
//   BL: (px - H·s,  py + H·c)
//   BR: (px + W·c - H·s, py + W·s + H·c)
// where c = cos(θ), s = sin(θ).
//
// For ALL corners to be within [0, pgW] × [0, pgH]:
//   px ∈ [-cornerMinX, pgW - cornerMaxX]
//   py ∈ [-cornerMinY, pgH - cornerMaxY]
//
function rotatedPlacementBounds(
  ldWMm: number, ldHMm: number,
  rotDeg: number,
  pgWMm: number, pgHMm: number
) {
  const θ = (rotDeg * Math.PI) / 180
  const c = Math.cos(θ), s = Math.sin(θ)

  // Corner offsets from origin (top-left = rotation pivot)
  const xs = [0, ldWMm * c, -ldHMm * s, ldWMm * c - ldHMm * s]
  const ys = [0, ldWMm * s,  ldHMm * c,  ldWMm * s + ldHMm * c]

  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)

  return {
    // Valid range for placement origin in mm
    minXMm: -minX,
    maxXMm: Math.max(0, pgWMm - maxX),
    minYMm: -minY,
    maxYMm: Math.max(0, pgHMm - maxY),
  }
}

// ── QR block preview inside a placement ───────────────────────────────────────
// Mirrors QrBlockNode in LabelDesignerCanvas: uses textRef + useLayoutEffect to
// measure actual rendered text width and center it over the QR block exactly.
// Memoized so it only re-renders when its own props change (block, payload, zoom, qrImg).
const QrBlockPreview = React.memo(function QrBlockPreview({ block, payload, zoom, qrImg }: {
  block: QrBlock
  payload: string
  zoom: number
  qrImg: HTMLImageElement | null
}) {
  const toK = (mm: number) => mmToKonva(mm, zoom)
  const sp = toK(block.sizeMm)
  const fp = Math.max(6, block.fontSize * zoom * PT_TO_CANVAS_SCALE)
  const tp = toK(block.textOffsetMm)
  const textRef = useRef<Konva.Text>(null)
  const [textX, setTextX] = useState(0)

  useLayoutEffect(() => {
    if (!block.showText || block.wrapText || !textRef.current) { setTextX(0); return }
    setTextX((sp - textRef.current.getTextWidth()) / 2)
  }, [block.showText, block.wrapText, payload, fp, block.fontFamily, sp])

  return (
    <Group x={toK(block.xMm)} y={toK(block.yMm)} rotation={block.rotationDeg} listening={false}>
      {qrImg
        ? <KImage image={qrImg} x={0} y={0} width={sp} height={sp} />
        : <Rect x={0} y={0} width={sp} height={sp} fill="#ddd" />}
      {block.showText && (
        <Text
          ref={textRef}
          text={payload}
          x={block.wrapText ? 0 : textX}
          y={block.textPosition === 'below' ? sp + tp : -(tp + fp)}
          width={block.wrapText ? sp : undefined}
          align={block.wrapText ? 'center' : 'left'}
          fontSize={fp} fontFamily={block.fontFamily} fill="#000"
          wrap={block.wrapText ? 'word' : 'none'}
          listening={false}
        />
      )}
    </Group>
  )
})

// ── Placement Node ─────────────────────────────────────────────────────────────
interface PlacementNodeProps {
  placement: Placement
  labelDesign: LabelDesign
  zoom: number
  payload: string
  index: number
  pageWMm: number
  pageHMm: number
  // Layer offset in Stage-absolute px — for correct dragBoundFunc
  layerOffsetX: number
  layerOffsetY: number
  isSelected: boolean
  onRef: (id: string, node: Konva.Group | null) => void
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void
  onDragStart: (id: string) => void
  onDragEnd: (id: string, xMm: number, yMm: number) => void
  onMultiDragMove: (id: string) => void
  onDragMove: (xPx: number, yPx: number, mx: number, my: number) => void
  onInteractEnd: () => void
}

function PlacementNode({
  placement, labelDesign, zoom, payload, index,
  pageWMm, pageHMm, layerOffsetX, layerOffsetY,
  isSelected, onRef, onSelect, onDragStart, onDragEnd, onMultiDragMove,
  onDragMove, onInteractEnd,
}: PlacementNodeProps) {
  const groupRef = useRef<Konva.Group>(null)

  useEffect(() => {
    if (groupRef.current) onRef(placement.id, groupRef.current)
    return () => { onRef(placement.id, null) }
  }, []) // eslint-disable-line
  const qrImg = useQrImage(payload)
  const toK = (mm: number) => mmToKonva(mm, zoom)

  const ldW = labelDesign.widthMm, ldH = labelDesign.heightMm
  const lw = toK(ldW), lh = toK(ldH)

  // Compute Stage-absolute drag bounds for current rotation.
  // Bounds depend on rotation because the rotated label occupies a different
  // axis-aligned bounding box at each angle.
  // Y bounds are additionally tightened by any text that extends outside the
  // label boundary (axis-aligned approximation; slightly conservative for rotated labels).
  const oh = textOverhang(labelDesign)
  const { minXMm, maxXMm, minYMm, maxYMm } = rotatedPlacementBounds(
    ldW, ldH, placement.rotationDeg, pageWMm, pageHMm
  )
  const minAbsX = layerOffsetX + toK(minXMm)
  const maxAbsX = layerOffsetX + toK(maxXMm)
  const minAbsY = layerOffsetY + toK(Math.max(minYMm, oh.top))
  const maxAbsY = layerOffsetY + toK(Math.max(0, maxYMm - oh.bottom))

  return (
    <>
      <Group
        ref={groupRef}
        x={toK(placement.xMm)} y={toK(placement.yMm)}
        rotation={placement.rotationDeg}
        draggable
        // Clamp in Stage-absolute coordinates during drag
        dragBoundFunc={pos => ({
          x: Math.max(minAbsX, Math.min(maxAbsX, pos.x)),
          y: Math.max(minAbsY, Math.min(maxAbsY, pos.y)),
        })}
        onClick={onSelect} onTap={onSelect}
        onDragStart={() => onDragStart(placement.id)}
        onDragMove={e => {
          onDragMove(e.target.x(), e.target.y(),
            (e.evt as MouseEvent).clientX, (e.evt as MouseEvent).clientY)
          onMultiDragMove(placement.id)
        }}
        onDragEnd={e => {
          onDragEnd(placement.id, konvaToMm(e.target.x(), zoom), konvaToMm(e.target.y(), zoom))
          onInteractEnd()
        }}
      >
        {/* Label background */}
        <Rect x={0} y={0} width={lw} height={lh} fill="white"
          stroke={isSelected ? '#7c6af7' : '#aaa'} strokeWidth={isSelected ? 1.5 : 0.8} />

        {/* QR blocks */}
        {labelDesign.qrBlocks.map(block => (
          <QrBlockPreview key={block.id} block={block} payload={payload} zoom={zoom} qrImg={qrImg} />
        ))}

        {/* Index badge */}
        <Text text={`#${index + 1}`} x={3} y={3}
          fontSize={Math.max(7, 8 * zoom)} fill="rgba(100,100,220,0.8)" listening={false} />
      </Group>

    </>
  )
}

// ── SheetLayoutCanvas ──────────────────────────────────────────────────────────
export function SheetLayoutCanvas() {
  const {
    placements, labelDesign, page, printConfig, unit, snapRotDeg,
    zoom, selectedIds, setSelected, toggleSelected,
    setSelectedIds, updatePlacement, showRuler,
    sheetScrollPos, setSheetScrollPos,
  } = useTemplateStore(useShallow(s => ({
    placements: s.template.placements,
    labelDesign: s.template.labelDesign,
    page: s.template.page,
    printConfig: s.template.printConfig,
    unit: s.template.unit,
    snapRotDeg: s.template.grid.snapRotationDeg,
    zoom: s.zoom, selectedIds: s.selectedIds,
    setSelected: s.setSelected, toggleSelected: s.toggleSelected,
    setSelectedIds: s.setSelectedIds, updatePlacement: s.updatePlacement,
    showRuler: s.showRuler,
    sheetScrollPos: s.sheetScrollPos, setSheetScrollPos: s.setSheetScrollPos,
  })))
  const { showDrag, showRotate, hide } = useTransformHUD()

  const scrollRef           = useRef<HTMLDivElement>(null)
  const stageRef            = useRef<Konva.Stage>(null)
  const contentLayerRef     = useRef<Konva.Layer>(null)
  const placementGroupRefs  = useRef<Map<string, Konva.Group>>(new Map())
  const multiDragStart      = useRef<Map<string, { x: number; y: number }> | null>(null)
  const sharedTrRef         = useRef<Konva.Transformer>(null)

  const snapDeg = useCallback((deg: number) => snapRotDeg ? Math.round(deg / snapRotDeg) * snapRotDeg : deg, [snapRotDeg])

  const handlePlacementRef = useCallback((id: string, node: Konva.Group | null) => {
    if (node) placementGroupRefs.current.set(id, node)
    else placementGroupRefs.current.delete(id)
  }, [])

  const handlePlacementDragStart = useCallback((leaderId: string) => {
    const ids = useTemplateStore.getState().selectedIds
    if (!ids.includes(leaderId) || ids.length <= 1) { multiDragStart.current = null; return }
    const starts = new Map<string, { x: number; y: number }>()
    for (const id of ids) {
      const node = placementGroupRefs.current.get(id)
      if (node) starts.set(id, { x: node.x(), y: node.y() })
    }
    multiDragStart.current = starts
  }, [])

  const handlePlacementMultiDragMove = useCallback((leaderId: string) => {
    if (!multiDragStart.current) return
    const leaderNode  = placementGroupRefs.current.get(leaderId)
    const leaderStart = multiDragStart.current.get(leaderId)
    if (!leaderNode || !leaderStart) return
    const dx = leaderNode.x() - leaderStart.x
    const dy = leaderNode.y() - leaderStart.y
    for (const [id, start] of multiDragStart.current) {
      if (id === leaderId) continue
      const node = placementGroupRefs.current.get(id)
      if (node) { node.x(start.x + dx); node.y(start.y + dy) }
    }
    leaderNode.getLayer()?.batchDraw()
  }, [])

  const handlePlacementDragEnd = useCallback((leaderId: string, leaderXMm: number, leaderYMm: number) => {
    if (!multiDragStart.current) {
      updatePlacement(leaderId, { xMm: leaderXMm, yMm: leaderYMm })
      return
    }
    const leaderNode  = placementGroupRefs.current.get(leaderId)
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
    useTemplateStore.getState().updateManyPlacements(updates)
    multiDragStart.current = null
  }, [updatePlacement])

  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 })

  // Rubber-band selection state
  const [selBox, setSelBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const selBoxRef       = useRef(selBox)
  const isRubberBanding = useRef(false)

  const toK = useCallback((mm: number) => mmToKonva(mm, zoom), [zoom])

  const contentW = toK(page.widthMm)
  const contentH = toK(page.heightMm)
  const rl = showRuler ? RULER_SIZE : 0

  const contentX = CANVAS_MARGIN
  const contentY = CANVAS_MARGIN

  const totalW = Math.max(containerSize.w - rl, contentW + CANVAS_MARGIN * 2)
  const totalH = Math.max(containerSize.h - rl, contentH + CANVAS_MARGIN * 2)
  const rulerOriginX = contentX - scroll.x + rl
  const rulerOriginY = contentY - scroll.y + rl

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
      if (scrollRef.current) setSheetScrollPos(scrollRef.current.scrollLeft, scrollRef.current.scrollTop)
    }
  }, []) // eslint-disable-line

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      setScroll({ x: el.scrollLeft, y: el.scrollTop })
      setSheetScrollPos(el.scrollLeft, el.scrollTop)
    }
  }, [setSheetScrollPos])

  // Explicitly redraw when labelDesign changes (e.g. after editing in label mode)
  useEffect(() => {
    contentLayerRef.current?.batchDraw()
  }, [labelDesign])

  // Sync shared Transformer to the currently selected placement nodes
  useEffect(() => {
    const tr = sharedTrRef.current
    if (!tr) return
    const nodes = selectedIds
      .map(id => placementGroupRefs.current.get(id))
      .filter((n): n is Konva.Group => !!n)
    tr.nodes(nodes)
    tr.getLayer()?.batchDraw()
  }, [selectedIds])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // Do not intercept keyboard events when an input field has focus
      const tag = (e.target as HTMLElement)?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return

      const s = useTemplateStore.getState()
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { s.undo(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { s.redo(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedIds.length > 0) {
        s.duplicateSelectedPlacements(); e.preventDefault()
      }
      if (e.key === 'Delete' && selectedIds.length > 0) s.deleteSelectedPlacements()
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        s.setSelectedIds(placements.map(p => p.id)); e.preventDefault()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') { s.copySelected(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') { s.pasteClipboard(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) { s.zoomIn(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.code === 'NumpadSubtract')) { s.zoomOut(); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Numpad0')) { s.resetZoom(); e.preventDefault() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedIds, placements])

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
      const s = useTemplateStore.getState()
      const z = s.zoom
      const ldW = s.template.labelDesign.widthMm
      const ldH = s.template.labelDesign.heightMm
      if (rx2 - rx1 < 3 && ry2 - ry1 < 3) { s.setSelectedIds([]); return }
      const hits = s.template.placements.filter(pl => {
        const px1 = mmToKonva(pl.xMm, z)
        const px2 = px1 + mmToKonva(ldW, z)
        const py1 = mmToKonva(pl.yMm, z)
        const py2 = py1 + mmToKonva(ldH, z)
        return rx1 < px2 && rx2 > px1 && ry1 < py2 && ry2 > py1
      })
      s.setSelectedIds(hits.map(p => p.id))
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [contentX, contentY])

  useCanvasScroll(scrollRef, sheetScrollPos, containerSize, zoom)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {selectedIds.length >= 2 && <AlignToolbar />}

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--canvas-bg)' }}>
        {showRuler && (
          <Rulers widthMm={page.widthMm} heightMm={page.heightMm}
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

              {/* Content layer — x/y is the layerOffset we pass to PlacementNode */}
              <Layer ref={contentLayerRef} x={contentX} y={contentY}>
                {/* Page shadow */}
                <Rect x={4} y={4} width={contentW} height={contentH} fill="rgba(0,0,0,0.22)" listening={false} />
                {/* Page background */}
                <Rect x={0} y={0} width={contentW} height={contentH} fill="white" listening={false} />
                {/* Page border */}
                <Rect x={0} y={0} width={contentW} height={contentH}
                  fill="transparent" stroke="#666" strokeWidth={0.5} listening={false} />

                {placements.map((pl, i) => (
                  <PlacementNode
                    key={pl.id}
                    placement={pl} labelDesign={labelDesign} zoom={zoom}
                    payload={getPreviewPayload(printConfig, i, pl.numberOffset ?? 0)}
                    index={i}
                    pageWMm={page.widthMm} pageHMm={page.heightMm}
                    layerOffsetX={contentX} layerOffsetY={contentY}
                    isSelected={selectedIds.includes(pl.id)}
                    onRef={handlePlacementRef}
                    onSelect={e => {
                      e.cancelBubble = true
                      if ((e.evt as MouseEvent).shiftKey) toggleSelected(pl.id)
                      else setSelected(pl.id)
                    }}
                    onDragStart={handlePlacementDragStart}
                    onMultiDragMove={handlePlacementMultiDragMove}
                    onDragMove={showDrag} onInteractEnd={hide}
                    onDragEnd={handlePlacementDragEnd}
                  />
                ))}

                {/* Shared Transformer — attached to all selected nodes at once.
                    Konva rotates them around the center of their combined bounding box. */}
                <Transformer
                  ref={sharedTrRef}
                  keepRatio={false}
                  resizeEnabled={false}
                  rotateEnabled
                  borderStroke="#7c6af7"
                  anchorStroke="#7c6af7"
                  anchorFill="#fff"
                  rotateAnchorOffset={24}
                  onTransform={e => {
                    const nodes = sharedTrRef.current?.nodes() ?? []
                    if (nodes.length > 0)
                      showRotate(nodes[0].rotation(), (e.evt as MouseEvent).clientX, (e.evt as MouseEvent).clientY)
                  }}
                  onTransformEnd={e => {
                    const z  = useTemplateStore.getState().zoom
                    const ld = useTemplateStore.getState().template.labelDesign
                    const pg = useTemplateStore.getState().template.page
                    const updates = (sharedTrRef.current?.nodes() ?? []).map(node => {
                      const g = node as Konva.Group
                      g.scaleX(1); g.scaleY(1)
                      const rot = snapDeg(((g.rotation() % 360) + 360) % 360) % 360
                      const b = rotatedPlacementBounds(ld.widthMm, ld.heightMm, rot, pg.widthMm, pg.heightMm)
                      // Reverse-lookup: find placement id from the group node
                      let id = ''
                      for (const [pid, pnode] of placementGroupRefs.current) {
                        if (pnode === g) { id = pid; break }
                      }
                      return {
                        id,
                        rotationDeg: rot,
                        xMm: Math.max(b.minXMm, Math.min(b.maxXMm, konvaToMm(g.x(), z))),
                        yMm: Math.max(b.minYMm, Math.min(b.maxYMm, konvaToMm(g.y(), z))),
                      }
                    }).filter(u => u.id !== '')
                    if (updates.length === 1) {
                      updatePlacement(updates[0].id, { rotationDeg: updates[0].rotationDeg, xMm: updates[0].xMm, yMm: updates[0].yMm })
                    } else if (updates.length > 1) {
                      useTemplateStore.getState().updateManyPlacements(updates)
                    }
                    hide()
                  }}
                />

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
