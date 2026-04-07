import { useTemplateStore } from '../store/templateStore'
import { konvaToMm, mmToUnit } from '../../../shared/units'
import type { Unit } from '../../../shared/schema'

export function useTransformHUD() {
  const setHUD = useTemplateStore(s => s.setHUD)
  const unit = useTemplateStore(s => s.template.unit) as Unit
  const zoom = useTemplateStore(s => s.zoom)

  const showDrag = (xPx: number, yPx: number, mx: number, my: number) =>
    setHUD({ type: 'drag', values: { X: mmToUnit(konvaToMm(xPx, zoom), unit), Y: mmToUnit(konvaToMm(yPx, zoom), unit) }, screenX: mx + 16, screenY: my - 44 })

  const showScale = (sizePx: number, origMm: number, mx: number, my: number) => {
    const sizeMm = konvaToMm(sizePx, zoom)
    setHUD({ type: 'scale', values: { size: mmToUnit(sizeMm, unit), pct: Math.round(sizeMm / origMm * 100) }, screenX: mx + 16, screenY: my - 44 })
  }

  const showRotate = (deg: number, mx: number, my: number) =>
    setHUD({ type: 'rotate', values: { deg: Math.round(((deg % 360) + 360) % 360 * 10) / 10 }, screenX: mx + 16, screenY: my - 44 })

  const hide = () => setHUD(null)

  return { showDrag, showScale, showRotate, hide }
}
