import type { PrintConfig } from './schema'

export interface NumberFormatConfig {
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
