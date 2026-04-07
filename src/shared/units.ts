import type { Unit } from './schema'

export const SCREEN_DPI = 96
export const MM_TO_PX_BASE = SCREEN_DPI / 25.4 // ~3.7795 px per mm at 96dpi
export const PT_TO_MM = 25.4 / 72             // 1 typographic point in mm

export function mmToUnit(mm: number, unit: Unit): number {
  switch (unit) {
    case 'cm': return mm / 10
    case 'px': return mm * MM_TO_PX_BASE
    default: return mm
  }
}

export function unitToMm(value: number, unit: Unit): number {
  switch (unit) {
    case 'cm': return value * 10
    case 'px': return value / MM_TO_PX_BASE
    default: return value
  }
}

export function mmToKonva(mm: number, zoom: number): number {
  return mm * MM_TO_PX_BASE * zoom
}

export function konvaToMm(px: number, zoom: number): number {
  return px / MM_TO_PX_BASE / zoom
}

export function unitLabel(unit: Unit): string {
  return unit
}

export function formatValue(mm: number, unit: Unit, decimals = 2): string {
  return mmToUnit(mm, unit).toFixed(decimals)
}

export function unitPrecision(unit: Unit): number {
  switch (unit) {
    case 'px': return 0
    case 'cm': return 3
    default: return 2
  }
}
