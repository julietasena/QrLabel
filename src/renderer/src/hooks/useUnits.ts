import { useTemplateStore } from '../store/templateStore'
import { mmToUnit, unitToMm, mmToKonva, konvaToMm, unitLabel, unitPrecision } from '../../../shared/units'
import type { Unit } from '../../../shared/schema'

export function useUnits() {
  const unit = useTemplateStore(s => s.template.unit)
  const zoom = useTemplateStore(s => s.zoom)
  return {
    unit,
    label: unitLabel(unit),
    precision: unitPrecision(unit),
    toDisplay: (mm: number) => mmToUnit(mm, unit),
    fromDisplay: (v: number) => unitToMm(v, unit),
    toKonva: (mm: number) => mmToKonva(mm, zoom),
    fromKonva: (px: number) => konvaToMm(px, zoom),
    fmt: (mm: number, dp?: number) => mmToUnit(mm, unit).toFixed(dp ?? unitPrecision(unit))
  }
}
