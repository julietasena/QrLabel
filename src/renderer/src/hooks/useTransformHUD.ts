import { useTemplateStore } from '../store/templateStore'
import { konvaToMm, mmToUnit } from '../../../shared/units'
import type { Unit } from '../../../shared/schema'

const HUD_OFFSET_X = 16
const HUD_OFFSET_Y = -44

export function useTransformHUD() {
  const setHUD = useTemplateStore(s => s.setHUD)
  const unit = useTemplateStore(s => s.template.unit) as Unit
  const zoom = useTemplateStore(s => s.zoom)

  const showDrag = (xPx: number, yPx: number, mx: number, my: number) =>
    setHUD({ type: 'drag', values: { X: mmToUnit(konvaToMm(xPx, zoom), unit), Y: mmToUnit(konvaToMm(yPx, zoom), unit) }, screenX: mx + HUD_OFFSET_X, screenY: my + HUD_OFFSET_Y })

  const showScale = (sizePx: number, origMm: number, mx: number, my: number) => {
    const sizeMm = konvaToMm(sizePx, zoom)
    setHUD({ type: 'scale', values: { size: mmToUnit(sizeMm, unit), pct: Math.round(sizeMm / origMm * 100) }, screenX: mx + HUD_OFFSET_X, screenY: my + HUD_OFFSET_Y })
  }

  const showRotate = (deg: number, mx: number, my: number) =>
    setHUD({ type: 'rotate', values: { deg: Math.round(((deg % 360) + 360) % 360 * 10) / 10 }, screenX: mx + HUD_OFFSET_X, screenY: my + HUD_OFFSET_Y })

  const hide = () => setHUD(null)

  return { showDrag, showScale, showRotate, hide }
}
