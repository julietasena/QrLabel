import React, { useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { mmToKonva, mmToUnit } from '../../../../shared/units'
import type { Unit } from '../../../../shared/schema'

export const RULER_SIZE = 20

interface Props {
  widthMm: number
  heightMm: number
  zoom: number
  unit: Unit
  // Where mm=0 sits in the scrollable area (canvas origin relative to scroll container)
  originX: number
  originY: number
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  isH: boolean,
  totalMm: number,
  zoom: number,
  unit: Unit,
  originPx: number,   // where mm=0 is, in canvas coords (already accounting for scroll)
  canvasSize: number
) {
  const dpr = window.devicePixelRatio || 1
  const w = isH ? canvasSize : RULER_SIZE
  const h = isH ? RULER_SIZE : canvasSize
  ctx.canvas.width  = w * dpr
  ctx.canvas.height = h * dpr
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#1e1e2e'
  ctx.fillRect(0, 0, w, h)

  ctx.font = `9px "Segoe UI", system-ui, ui-sans-serif, sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#7878a0'
  ctx.strokeStyle = '#3a3a5a'
  ctx.lineWidth = 1

  const pxPerMm = mmToKonva(1, zoom)
  const minTickPx = 45
  const rawMm = minTickPx / pxPerMm
  const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200]
  const tickMm = candidates.find(c => c >= rawMm) ?? 200

  for (let mm = -tickMm * 2; mm <= totalMm + tickMm * 2; mm += tickMm) {
    const pos = originPx + mmToKonva(mm, zoom)
    if (isH) {
      if (pos < RULER_SIZE || pos > canvasSize + 5) continue
      ctx.beginPath(); ctx.moveTo(pos, RULER_SIZE - 6); ctx.lineTo(pos, RULER_SIZE); ctx.stroke()
      ctx.fillText(String(Math.round(mmToUnit(mm, unit) * 10) / 10), pos + 2, 2)
    } else {
      if (pos < RULER_SIZE || pos > canvasSize + 5) continue
      ctx.beginPath(); ctx.moveTo(RULER_SIZE - 6, pos); ctx.lineTo(RULER_SIZE, pos); ctx.stroke()
      ctx.save(); ctx.translate(2, pos - 1); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(mmToUnit(mm, unit) * 10) / 10), 0, 0); ctx.restore()
    }
  }
}

export function Rulers({ widthMm, heightMm, zoom, unit, originX, originY }: Props) {
  const hRef = useRef<HTMLCanvasElement>(null)
  const vRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)

  const redraw = useCallback(() => {
    // Cancel any pending frame so rapid scroll events are coalesced into one draw
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = containerRef.current
      if (!el) return
      const { width, height } = el.getBoundingClientRect()
      const hCtx = hRef.current?.getContext('2d')
      const vCtx = vRef.current?.getContext('2d')
      if (hCtx) drawRuler(hCtx, true,  widthMm,  zoom, unit, originX, width  - RULER_SIZE)
      if (vCtx) drawRuler(vCtx, false, heightMm, zoom, unit, originY, height - RULER_SIZE)
    })
  }, [widthMm, heightMm, zoom, unit, originX, originY])

  useEffect(() => { redraw() }, [redraw])

  // Cancel any pending RAF on unmount
  useLayoutEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  useEffect(() => {
    const ro = new ResizeObserver(redraw)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [redraw])

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}>
      {/* Corner */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: RULER_SIZE, height: RULER_SIZE,
        background: '#1e1e2e', zIndex: 12, borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }} />
      {/* Horizontal */}
      <div style={{ position: 'absolute', top: 0, left: RULER_SIZE, right: 0, height: RULER_SIZE,
        overflow: 'hidden', borderBottom: '1px solid var(--border)' }}>
        <canvas ref={hRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: RULER_SIZE }} />
      </div>
      {/* Vertical */}
      <div style={{ position: 'absolute', top: RULER_SIZE, left: 0, width: RULER_SIZE, bottom: 0,
        overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
        <canvas ref={vRef} style={{ position: 'absolute', top: 0, left: 0, width: RULER_SIZE, height: '100%' }} />
      </div>
    </div>
  )
}
