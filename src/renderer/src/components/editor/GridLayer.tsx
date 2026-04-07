import React from 'react'
import { Line } from 'react-konva'
import { mmToKonva } from '../../../../shared/units'

interface Props {
  widthMm: number
  heightMm: number
  spacingMm: number
  zoom: number
}

export function GridLayer({ widthMm, heightMm, spacingMm, zoom }: Props) {
  const toK = (mm: number) => mmToKonva(mm, zoom)
  const w = toK(widthMm), h = toK(heightMm)
  const sp = toK(spacingMm)
  if (sp < 3) return null // too small to draw

  const lines: React.ReactNode[] = []
  for (let x = 0; x <= w + sp; x += sp) {
    lines.push(<Line key={`v${x}`} points={[x, 0, x, h]} stroke="rgba(255,255,255,0.07)" strokeWidth={1} listening={false} />)
  }
  for (let y = 0; y <= h + sp; y += sp) {
    lines.push(<Line key={`h${y}`} points={[0, y, w, y]} stroke="rgba(255,255,255,0.07)" strokeWidth={1} listening={false} />)
  }
  return <>{lines}</>
}
