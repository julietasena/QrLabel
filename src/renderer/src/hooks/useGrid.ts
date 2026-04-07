import { useTemplateStore } from '../store/templateStore'
import { mmToKonva } from '../../../shared/units'

export function useGrid() {
  const grid = useTemplateStore(s => s.template.grid)
  const zoom = useTemplateStore(s => s.zoom)

  function snapMm(mm: number): number {
    if (!grid.snap) return mm
    return Math.round(mm / grid.spacingMm) * grid.spacingMm
  }
  function snapDeg(deg: number): number {
    if (!grid.snapRotationDeg) return deg
    return Math.round(deg / grid.snapRotationDeg) * grid.snapRotationDeg
  }

  return { grid, spacingPx: mmToKonva(grid.spacingMm, zoom), snapMm, snapDeg }
}
