import { z } from 'zod'

export const UnitSchema = z.enum(['mm', 'cm', 'px'])
export type Unit = z.infer<typeof UnitSchema>

export const PagePresetSchema = z.enum(['A4', 'Legal', 'Oficio', 'custom'])
export type PagePreset = z.infer<typeof PagePresetSchema>

export const NumberingModeSchema = z.enum(['sequential', 'offset'])
export type NumberingMode = z.infer<typeof NumberingModeSchema>

export const TextPositionSchema = z.enum(['above', 'below'])
export type TextPosition = z.infer<typeof TextPositionSchema>

export const SnapRotationSchema = z.union([z.literal(15), z.literal(45), z.literal(90), z.null()])
export type SnapRotation = z.infer<typeof SnapRotationSchema>

export const PageSchema = z.object({
  preset: PagePresetSchema,
  widthMm: z.number().positive(),
  heightMm: z.number().positive()
})
export type Page = z.infer<typeof PageSchema>

export const GridSchema = z.object({
  spacingMm: z.number().positive().default(5),
  snap: z.boolean().default(false),
  visible: z.boolean().default(true),
  snapRotationDeg: SnapRotationSchema.default(null)
})
export type Grid = z.infer<typeof GridSchema>

export const QrBlockSchema = z.object({
  id: z.string().uuid(),
  xMm: z.number(),
  yMm: z.number(),
  sizeMm: z.number().positive(),
  rotationDeg: z.number().gte(0).lt(360),
  showText: z.boolean().default(true),
  textPosition: TextPositionSchema.default('below'),
  textOffsetMm: z.number().min(0).default(1),
  fontSize: z.number().positive().default(10),
  fontFamily: z.string().default('Roboto Mono'),
  wrapText: z.boolean().default(false)
})
export type QrBlock = z.infer<typeof QrBlockSchema>

export const LabelDesignSchema = z.object({
  widthMm: z.number().positive(),
  heightMm: z.number().positive(),
  qrBlocks: z.array(QrBlockSchema)
})
export type LabelDesign = z.infer<typeof LabelDesignSchema>

export const PlacementSchema = z.object({
  id: z.string().uuid(),
  xMm: z.number(),
  yMm: z.number(),
  rotationDeg: z.number().gte(0).lt(360).default(0),
  numberOffset: z.number().int().min(0).default(0)
})
export type Placement = z.infer<typeof PlacementSchema>

export const PrintRecordSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  step: z.number().int().positive(),
  padWidth: z.number().int().min(0).max(10),
  prefix: z.string(),
  suffix: z.string(),
  printedAt: z.string(),
  totalPrinted: z.number().int(),
  printerName: z.string()
})
export type PrintRecord = z.infer<typeof PrintRecordSchema>

// PrintConfig lives in the template so the canvas always shows a real preview
export const PrintConfigSchema = z.object({
  padWidth: z.number().int().min(0).max(10).default(6),
  prefix: z.string().default(''),
  suffix: z.string().default(''),
  step: z.number().int().positive().default(1),
  previewNumber: z.number().int().min(0).default(1),
  numberingMode: NumberingModeSchema.default('sequential')
})
export type PrintConfig = z.infer<typeof PrintConfigSchema>

export const TemplateSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  unit: UnitSchema,
  page: PageSchema,
  grid: GridSchema,
  labelDesign: LabelDesignSchema,
  placements: z.array(PlacementSchema),
  printConfig: PrintConfigSchema.default({}),
  printHistory: z.object({
    records: z.array(PrintRecordSchema).default([])
  })
})
export type Template = z.infer<typeof TemplateSchema>

export interface PrintJobConfig {
  labelDesign: LabelDesign
  placements: Placement[]
  page: Page
  printConfig: PrintConfig
  printerName: string
  start: number
  end: number
}

export interface PrintProgress {
  currentPage: number
  totalPages: number
  currentLabel: string
  currentNumber: number
  status: 'printing' | 'spooled' | 'paused' | 'error' | 'done' | 'cancelled'
  errorMessage?: string
}

export const PAGE_PRESETS: Record<Exclude<PagePreset, 'custom'>, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  Legal: { widthMm: 215.9, heightMm: 355.6 },
  Oficio: { widthMm: 216, heightMm: 330 }
}

export const MAX_LABELS = 5000

export function createDefaultTemplate(name = 'Nueva plantilla'): Template {
  return {
    version: 1,
    name,
    unit: 'mm',
    page: { preset: 'A4', widthMm: 210, heightMm: 297 },
    grid: { spacingMm: 5, snap: true, visible: true, snapRotationDeg: null },
    labelDesign: { widthMm: 50, heightMm: 30, qrBlocks: [] },
    placements: [],
    printConfig: { padWidth: 6, prefix: '', suffix: '', step: 1, previewNumber: 1, numberingMode: 'sequential' },
    printHistory: { records: [] }
  }
}
