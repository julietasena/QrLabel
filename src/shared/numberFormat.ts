import type { PrintConfig, NumberingMode } from './schema'

interface NumberFormatConfig {
  start: number
  end: number
  step: number
  padWidth: number
  prefix: string
  suffix: string
}

export function formatPayload(num: number, cfg: Pick<NumberFormatConfig, 'padWidth' | 'prefix' | 'suffix'>): string {
  const padded = String(num).padStart(cfg.padWidth, '0')
  return `${cfg.prefix}${padded}${cfg.suffix}`
}

export function previewPayloadFromConfig(cfg: PrintConfig): string {
  return formatPayload(cfg.previewNumber, cfg)
}

export function countLabels(cfg: NumberFormatConfig): number {
  if (cfg.end < cfg.start) return 0
  return Math.floor((cfg.end - cfg.start) / cfg.step) + 1
}

export function validatePrintRange(start: number, end: number, step: number): string | null {
  if (start < 0) return 'El número inicial debe ser ≥ 0'
  if (end < start) return 'El número final debe ser ≥ al inicial'
  if (step < 1) return 'El paso debe ser ≥ 1'
  return null
}

export { MAX_LABELS } from './schema'

// How many pages a job requires given the number of distinct label numbers and placements per page.
// offset mode: each number fills one page (each placement gets base + its own offset).
// sequential mode: placements share a pool of numbers, filling pages left to right.
export function computePageCount(labelCount: number, placementCount: number, mode: NumberingMode): number {
  if (placementCount === 0) return 0
  return mode === 'offset' ? labelCount : Math.ceil(labelCount / placementCount)
}

// Total physical labels printed: in sequential mode equals labelCount; in offset mode
// each page prints one label per placement, so multiply.
export function computeTotalLabels(labelCount: number, placementCount: number, mode: NumberingMode): number {
  return mode === 'offset' ? labelCount * placementCount : labelCount
}

// Payload string to display on the canvas for a given placement slot.
// placementIndex: position of this placement in the placements array (0-based).
// numberOffset: the placement's own numberOffset field.
export function getPreviewPayload(pc: PrintConfig, placementIndex: number, numberOffset: number): string {
  if (pc.numberingMode === 'offset') {
    return formatPayload(pc.previewNumber + numberOffset, pc)
  }
  return formatPayload(pc.previewNumber + placementIndex * pc.step, pc)
}
