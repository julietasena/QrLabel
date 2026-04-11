import type { StateCreator } from 'zustand'
import { produce } from 'immer'
import { v4 as uuidv4 } from 'uuid'
import type { Template, LabelDesign, QrBlock, Placement, Unit, Grid, Page, PrintConfig } from '../../../shared/schema'
import { createDefaultTemplate } from '../../../shared/schema'
import { clearQrCache } from '../../../shared/qr'
import { textOverhang, qrBlockValidBounds, maxQrSizeMm } from '../../../shared/geometry'

// Module-level clipboard — excluded from undo snapshots intentionally
let clipboard:
  | { type: 'qrblocks'; items: QrBlock[] }
  | { type: 'placements'; items: Placement[] }
  | null = null

interface Snapshot { labelDesign: LabelDesign; placements: Placement[] }

const MAX_HIST = 50

function snap(t: Template): Snapshot {
  return { labelDesign: structuredClone(t.labelDesign), placements: structuredClone(t.placements) }
}

function withUndo(s: Pick<TemplateSlice, 'past' | 'future' | 'template'>) {
  return { past: [...s.past.slice(-MAX_HIST), snap(s.template)], future: [] as Snapshot[] }
}

// Minimal UI fields that template mutations cross-write.
// Forward-declared here to avoid a circular import with uiSlice.ts.
interface RequiredUIState {
  mode: 'label' | 'sheet'
  showGrid: boolean
  selectedIds: string[]
  labelScrollPos: { x: number; y: number }
  sheetScrollPos: { x: number; y: number }
}

type BoundStore = TemplateSlice & RequiredUIState

export interface TemplateSlice {
  // Data
  template: Template
  isDirty: boolean
  currentFilename: string | null

  // Undo/Redo history
  past: Snapshot[]
  future: Snapshot[]

  // Template management
  newTemplate: (name?: string) => void
  setTemplate: (t: Template, filename: string) => void
  setDirty: (d: boolean) => void
  setFilename: (n: string) => void
  updateTemplateName: (n: string) => void
  updatePage: (p: Page) => void
  updateUnit: (u: Unit) => void
  updateGrid: (g: Partial<Grid>) => void
  updatePrintConfig: (c: Partial<PrintConfig>) => void
  toggleGrid: () => void

  // LabelDesign mutations (undo-tracked)
  updateLabelDesignSize: (w: number, h: number) => void
  addQrBlock: () => void
  duplicateQrBlock: (id: string) => void
  deleteQrBlock: (id: string) => void
  updateQrBlock: (id: string, changes: Partial<QrBlock>, pushUndo?: boolean) => void

  // Placement mutations (undo-tracked)
  addPlacement: () => void
  duplicatePlacement: (id: string) => void
  deletePlacement: (id: string) => void
  deleteSelectedPlacements: () => void
  updatePlacement: (id: string, changes: Partial<Placement>, pushUndo?: boolean) => void
  updateSelectedPlacements: (changes: Partial<Placement>) => void

  // Multi-select actions
  duplicateSelectedQrBlocks: () => void
  duplicateSelectedPlacements: () => void
  deleteSelectedQrBlocks: () => void
  copySelected: () => void
  pasteClipboard: () => void
  updateManyQrBlocks: (updates: { id: string; xMm: number; yMm: number }[]) => void
  updateManyPlacements: (updates: { id: string; xMm: number; yMm: number }[]) => void

  // Alignment
  alignQrBlocks: (axis: 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV') => void
  distributeQrBlocks: (dir: 'horizontal' | 'vertical') => void
  alignPlacements: (axis: 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV') => void
  distributePlacements: (dir: 'horizontal' | 'vertical') => void

  // Undo/Redo
  pushUndo: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

export const createTemplateSlice: StateCreator<BoundStore, [], [], TemplateSlice> = (set, get) => ({
  template: createDefaultTemplate(),
  isDirty: false,
  currentFilename: null,
  past: [],
  future: [],

  // ── Template ──────────────────────────────────────────────────────────────
  newTemplate: (name = 'Nueva plantilla') => {
    clearQrCache()
    set({
      template: createDefaultTemplate(name),
      isDirty: false,
      currentFilename: null,
      selectedIds: [],
      past: [],
      future: [],
      labelScrollPos: { x: 0, y: 0 },
      sheetScrollPos: { x: 0, y: 0 },
    })
  },

  setTemplate: (t, filename) => {
    clearQrCache()
    // Backward compatibility: old templates may persist unit="px".
    // Runtime editing supports only mm/cm, so normalize to mm at load boundary.
    const normalizedUnit: Unit = t.unit === 'px' ? 'mm' : t.unit
    const normalizedTemplate = normalizedUnit === t.unit ? t : { ...t, unit: normalizedUnit }
    const syncedTemplate = normalizedTemplate
    set({
      template: syncedTemplate,
      isDirty: false,
      currentFilename: filename,
      selectedIds: [],
      past: [],
      future: [],
      showGrid: syncedTemplate.grid.visible,
      labelScrollPos: { x: 0, y: 0 },
      sheetScrollPos: { x: 0, y: 0 },
    })
  },

  setDirty: d => set({ isDirty: d }),
  setFilename: n => set({ currentFilename: n }),
  updateTemplateName: n => set(s => ({ template: { ...s.template, name: n }, isDirty: true })),
  updatePage: p => set(s => ({ template: { ...s.template, page: p }, isDirty: true })),
  updateUnit: u => set(s => ({
    template: { ...s.template, unit: u === 'px' ? 'mm' : u },
    isDirty: true
  })),
  updateGrid: partial => set(s => ({
    template: produce(s.template, d => { Object.assign(d.grid, partial) }),
    isDirty: true,
    showGrid: partial.visible !== undefined ? partial.visible : s.showGrid
  })),
  updatePrintConfig: partial => set(s => ({
    template: produce(s.template, d => { Object.assign(d.printConfig, partial) }),
    isDirty: true
  })),
  toggleGrid: () => set(s => {
    const visible = !s.showGrid
    return {
      showGrid: visible,
      template: produce(s.template, d => { d.grid.visible = visible }),
      isDirty: true
    }
  }),

  // ── LabelDesign ───────────────────────────────────────────────────────────
  pushUndo: () => set(s => ({ ...withUndo(s) })),

  updateLabelDesignSize: (w, h) => {
    const s = get()
    const pg = s.template.page
    const clampedW = Math.min(Math.max(1, w), pg.widthMm)
    const clampedH = Math.min(Math.max(1, h), pg.heightMm)
    set({
      ...withUndo(s),
      template: produce(s.template, d => {
        d.labelDesign.widthMm  = clampedW
        d.labelDesign.heightMm = clampedH
        // Re-clamp all placements to the new label bounds
        const oh = textOverhang(d.labelDesign)
        for (const p of d.placements) {
          p.xMm = Math.max(0, Math.min(pg.widthMm  - clampedW,  p.xMm))
          p.yMm = Math.max(oh.top, Math.min(pg.heightMm - clampedH - oh.bottom, p.yMm))
        }
      }),
      isDirty: true
    })
  },

  addQrBlock: () => {
    const s = get()
    const ld = s.template.labelDesign
    const defaultSize = Math.min(30, Math.max(5, Math.min(ld.widthMm, ld.heightMm) * 0.4))
    const xMm = Math.max(0, (ld.widthMm  - defaultSize) / 2)
    const yMm = Math.max(0, (ld.heightMm - defaultSize) / 2)
    const block: QrBlock = {
      id: uuidv4(), xMm, yMm, sizeMm: defaultSize, rotationDeg: 0,
      showText: true, textPosition: 'below', textOffsetMm: 1, fontSize: 8, fontFamily: 'Roboto Mono', wrapText: false
    }
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.labelDesign.qrBlocks.push(block) }),
      isDirty: true,
      selectedIds: [block.id]
    })
  },

  duplicateQrBlock: id => {
    const s = get()
    const src = s.template.labelDesign.qrBlocks.find(b => b.id === id)
    if (!src) return
    const ld = s.template.labelDesign
    const copy: QrBlock = { ...structuredClone(src), id: uuidv4(),
      xMm: Math.min(src.xMm + 3, ld.widthMm  - src.sizeMm),
      yMm: Math.min(src.yMm + 3, ld.heightMm - src.sizeMm)
    }
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.labelDesign.qrBlocks.push(copy) }),
      isDirty: true,
      selectedIds: [copy.id]
    })
  },

  deleteQrBlock: id => {
    const s = get()
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.labelDesign.qrBlocks = d.labelDesign.qrBlocks.filter(b => b.id !== id) }),
      isDirty: true,
      selectedIds: []
    })
  },

  updateQrBlock: (id, changes, pushUndoFlag = true) => {
    const s = get()
    const ld = s.template.labelDesign
    set({
      past: pushUndoFlag ? [...s.past.slice(-MAX_HIST), snap(s.template)] : s.past,
      future: pushUndoFlag ? [] : s.future,
      template: produce(s.template, d => {
        const b = d.labelDesign.qrBlocks.find(x => x.id === id)
        if (!b) return
        Object.assign(b, changes)
        // Clamp size using the rotation-aware max: a rotated QR occupies
        // sizeMm·(|cosθ|+|sinθ|) on each axis, so the axis-aligned max is wrong.
        b.sizeMm = Math.max(1, Math.min(b.sizeMm, maxQrSizeMm(b, ld.widthMm, ld.heightMm)))
        // Clamp position using rotation-aware bounds so the whole rotated
        // footprint (QR + text) stays within the label. Fixes position jumps
        // when rotation changes via drag or manual panel input.
        const rb = qrBlockValidBounds(b, ld.widthMm, ld.heightMm)
        b.xMm = Math.max(rb.minXMm, Math.min(rb.maxXMm, b.xMm))
        b.yMm = Math.max(rb.minYMm, Math.min(rb.maxYMm, b.yMm))
      }),
      isDirty: true
    })
  },

  // ── Placements ────────────────────────────────────────────────────────────
  addPlacement: () => {
    const s = get()
    const pl: Placement = { id: uuidv4(), xMm: 10, yMm: 10, rotationDeg: 0, numberOffset: 0 }
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.placements.push(pl) }),
      isDirty: true,
      selectedIds: [pl.id]
    })
  },

  duplicatePlacement: id => {
    const s = get()
    const src = s.template.placements.find(p => p.id === id)
    if (!src) return
    const pg = s.template.page
    const ld = s.template.labelDesign
    const copy: Placement = { ...structuredClone(src), id: uuidv4(),
      xMm: Math.min(src.xMm + 3, pg.widthMm  - ld.widthMm),
      yMm: Math.min(src.yMm + 3, pg.heightMm - ld.heightMm)
    }
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.placements.push(copy) }),
      isDirty: true,
      selectedIds: [copy.id]
    })
  },

  deletePlacement: id => {
    const s = get()
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.placements = d.placements.filter(p => p.id !== id) }),
      isDirty: true,
      selectedIds: s.selectedIds.filter(x => x !== id)
    })
  },

  deleteSelectedPlacements: () => {
    const s = get()
    const ids = new Set(s.selectedIds)
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.placements = d.placements.filter(p => !ids.has(p.id)) }),
      isDirty: true,
      selectedIds: []
    })
  },

  updatePlacement: (id, changes, pushUndoFlag = true) => {
    const s = get()
    const pg = s.template.page
    const ld = s.template.labelDesign
    set({
      past: pushUndoFlag ? [...s.past.slice(-MAX_HIST), snap(s.template)] : s.past,
      future: pushUndoFlag ? [] : s.future,
      template: produce(s.template, d => {
        const p = d.placements.find(x => x.id === id)
        if (!p) return
        Object.assign(p, changes)
        // Basic axis-aligned clamp for panel input. The canvas dragBoundFunc handles
        // rotation-aware clamping during drag. textOverhang tightens Y so text stays in page.
        const oh = textOverhang(ld)
        p.xMm = Math.max(0, Math.min(pg.widthMm  - ld.widthMm,  p.xMm))
        p.yMm = Math.max(oh.top, Math.min(pg.heightMm - ld.heightMm - oh.bottom, p.yMm))
      }),
      isDirty: true
    })
  },

  updateSelectedPlacements: changes => {
    const s = get()
    const ids = new Set(s.selectedIds)
    set({
      ...withUndo(s),
      template: produce(s.template, d => {
        d.placements.forEach(p => { if (ids.has(p.id)) Object.assign(p, changes) })
      }),
      isDirty: true
    })
  },

  // ── Multi-select ──────────────────────────────────────────────────────────
  duplicateSelectedQrBlocks: () => {
    const s = get()
    const ld = s.template.labelDesign
    const srcs = ld.qrBlocks.filter(b => s.selectedIds.includes(b.id))
    if (srcs.length === 0) return
    const copies: QrBlock[] = srcs.map(src => ({
      ...JSON.parse(JSON.stringify(src)), id: uuidv4(),
      xMm: Math.min(src.xMm + 3, ld.widthMm  - src.sizeMm),
      yMm: Math.min(src.yMm + 3, ld.heightMm - src.sizeMm)
    }))
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.labelDesign.qrBlocks.push(...copies) }),
      isDirty: true,
      selectedIds: copies.map(c => c.id)
    })
  },

  duplicateSelectedPlacements: () => {
    const s = get()
    const pg = s.template.page
    const ld = s.template.labelDesign
    const srcs = s.template.placements.filter(p => s.selectedIds.includes(p.id))
    if (srcs.length === 0) return
    const copies: Placement[] = srcs.map(src => ({
      ...JSON.parse(JSON.stringify(src)), id: uuidv4(),
      xMm: Math.min(src.xMm + 3, pg.widthMm  - ld.widthMm),
      yMm: Math.min(src.yMm + 3, pg.heightMm - ld.heightMm)
    }))
    set({
      ...withUndo(s),
      template: produce(s.template, d => { d.placements.push(...copies) }),
      isDirty: true,
      selectedIds: copies.map(c => c.id)
    })
  },

  deleteSelectedQrBlocks: () => {
    const s = get()
    const ids = new Set(s.selectedIds)
    set({
      ...withUndo(s),
      template: produce(s.template, d => {
        d.labelDesign.qrBlocks = d.labelDesign.qrBlocks.filter(b => !ids.has(b.id))
      }),
      isDirty: true,
      selectedIds: []
    })
  },

  copySelected: () => {
    const { mode, selectedIds, template } = get()
    if (mode === 'label') {
      const items = template.labelDesign.qrBlocks.filter(b => selectedIds.includes(b.id))
      if (items.length > 0) clipboard = { type: 'qrblocks', items: structuredClone(items) }
    } else {
      const items = template.placements.filter(p => selectedIds.includes(p.id))
      if (items.length > 0) clipboard = { type: 'placements', items: structuredClone(items) }
    }
  },

  pasteClipboard: () => {
    if (!clipboard) return
    const s = get()
    if (clipboard.type === 'qrblocks' && s.mode === 'label') {
      const ld = s.template.labelDesign
      const newBlocks: QrBlock[] = clipboard.items.map(b => ({
        ...b, id: uuidv4(),
        xMm: Math.min(b.xMm + 3, ld.widthMm - b.sizeMm),
        yMm: Math.min(b.yMm + 3, ld.heightMm - b.sizeMm)
      }))
      clipboard = { type: 'qrblocks', items: clipboard.items.map(b => ({ ...b, xMm: b.xMm + 3, yMm: b.yMm + 3 })) }
      set({
        past: [...s.past.slice(-MAX_HIST), snap(s.template)],
        future: [],
        template: produce(s.template, d => { d.labelDesign.qrBlocks.push(...newBlocks) }),
        isDirty: true,
        selectedIds: newBlocks.map(b => b.id)
      })
    } else if (clipboard.type === 'placements' && s.mode === 'sheet') {
      const pg = s.template.page
      const ld = s.template.labelDesign
      const newPlacements: Placement[] = clipboard.items.map(p => ({
        ...p, id: uuidv4(),
        xMm: Math.min(p.xMm + 3, pg.widthMm - ld.widthMm),
        yMm: Math.min(p.yMm + 3, pg.heightMm - ld.heightMm)
      }))
      clipboard = { type: 'placements', items: clipboard.items.map(p => ({ ...p, xMm: p.xMm + 3, yMm: p.yMm + 3 })) }
      set({
        past: [...s.past.slice(-MAX_HIST), snap(s.template)],
        future: [],
        template: produce(s.template, d => { d.placements.push(...newPlacements) }),
        isDirty: true,
        selectedIds: newPlacements.map(p => p.id)
      })
    }
  },

  updateManyQrBlocks: updates => {
    const s = get()
    const ld = s.template.labelDesign
    set({
      ...withUndo(s),
      template: produce(s.template, d => {
        for (const { id, xMm, yMm } of updates) {
          const b = d.labelDesign.qrBlocks.find(x => x.id === id)
          if (!b) continue
          // Use rotation-aware bounds so rotated blocks clamp correctly
          const rb = qrBlockValidBounds(b, ld.widthMm, ld.heightMm)
          b.xMm = Math.max(rb.minXMm, Math.min(rb.maxXMm, xMm))
          b.yMm = Math.max(rb.minYMm, Math.min(rb.maxYMm, yMm))
        }
      }),
      isDirty: true
    })
  },

  updateManyPlacements: updates => {
    const s = get()
    const pg = s.template.page
    const ld = s.template.labelDesign
    const oh = textOverhang(ld)
    set({
      ...withUndo(s),
      template: produce(s.template, d => {
        for (const { id, xMm, yMm } of updates) {
          const p = d.placements.find(x => x.id === id)
          if (!p) continue
          p.xMm = Math.max(0, Math.min(pg.widthMm  - ld.widthMm,  xMm))
          p.yMm = Math.max(oh.top, Math.min(pg.heightMm - ld.heightMm - oh.bottom, yMm))
        }
      }),
      isDirty: true
    })
  },

  // ── Alignment ─────────────────────────────────────────────────────────────
  alignQrBlocks: axis => {
    const s = get()
    const { selectedIds, template } = s
    if (selectedIds.length < 2) return
    const sel = template.labelDesign.qrBlocks.filter(b => selectedIds.includes(b.id))
    let refVal: number
    switch (axis) {
      case 'left':    refVal = Math.min(...sel.map(b => b.xMm)); break
      case 'right':   refVal = Math.max(...sel.map(b => b.xMm + b.sizeMm)); break
      case 'top':     refVal = Math.min(...sel.map(b => b.yMm)); break
      case 'bottom':  refVal = Math.max(...sel.map(b => b.yMm + b.sizeMm)); break
      case 'centerH': refVal = (Math.min(...sel.map(b => b.xMm)) + Math.max(...sel.map(b => b.xMm + b.sizeMm))) / 2; break
      case 'centerV': refVal = (Math.min(...sel.map(b => b.yMm)) + Math.max(...sel.map(b => b.yMm + b.sizeMm))) / 2; break
    }
    set({
      ...withUndo(s),
      template: produce(template, d => {
        d.labelDesign.qrBlocks.forEach(b => {
          if (!selectedIds.includes(b.id)) return
          if (axis === 'left')    b.xMm = refVal
          if (axis === 'right')   b.xMm = refVal - b.sizeMm
          if (axis === 'top')     b.yMm = refVal
          if (axis === 'bottom')  b.yMm = refVal - b.sizeMm
          if (axis === 'centerH') b.xMm = refVal - b.sizeMm / 2
          if (axis === 'centerV') b.yMm = refVal - b.sizeMm / 2
        })
      }),
      isDirty: true
    })
  },

  distributeQrBlocks: dir => {
    const s = get()
    const { selectedIds, template } = s
    if (selectedIds.length < 3) return
    const sel = template.labelDesign.qrBlocks
      .filter(b => selectedIds.includes(b.id))
      .sort((a, b) => dir === 'horizontal' ? a.xMm - b.xMm : a.yMm - b.yMm)
    const first = dir === 'horizontal' ? sel[0].xMm : sel[0].yMm
    const last  = dir === 'horizontal' ? sel[sel.length - 1].xMm : sel[sel.length - 1].yMm
    const gap   = (last - first) / (sel.length - 1)
    set({
      ...withUndo(s),
      template: produce(template, d => {
        sel.forEach((orig, i) => {
          const b = d.labelDesign.qrBlocks.find(x => x.id === orig.id)!
          if (dir === 'horizontal') b.xMm = first + gap * i
          else b.yMm = first + gap * i
        })
      }),
      isDirty: true
    })
  },

  alignPlacements: axis => {
    const s = get()
    const { selectedIds, template } = s
    if (selectedIds.length < 2) return
    const sel = template.placements.filter(p => selectedIds.includes(p.id))
    const ld = template.labelDesign
    let refVal: number
    switch (axis) {
      case 'left':    refVal = Math.min(...sel.map(p => p.xMm)); break
      case 'right':   refVal = Math.max(...sel.map(p => p.xMm + ld.widthMm)); break
      case 'top':     refVal = Math.min(...sel.map(p => p.yMm)); break
      case 'bottom':  refVal = Math.max(...sel.map(p => p.yMm + ld.heightMm)); break
      case 'centerH': refVal = (Math.min(...sel.map(p => p.xMm)) + Math.max(...sel.map(p => p.xMm + ld.widthMm))) / 2; break
      case 'centerV': refVal = (Math.min(...sel.map(p => p.yMm)) + Math.max(...sel.map(p => p.yMm + ld.heightMm))) / 2; break
    }
    set({
      ...withUndo(s),
      template: produce(template, d => {
        d.placements.forEach(p => {
          if (!selectedIds.includes(p.id)) return
          if (axis === 'left')    p.xMm = refVal
          if (axis === 'right')   p.xMm = refVal - ld.widthMm
          if (axis === 'top')     p.yMm = refVal
          if (axis === 'bottom')  p.yMm = refVal - ld.heightMm
          if (axis === 'centerH') p.xMm = refVal - ld.widthMm / 2
          if (axis === 'centerV') p.yMm = refVal - ld.heightMm / 2
        })
      }),
      isDirty: true
    })
  },

  distributePlacements: dir => {
    const s = get()
    const { selectedIds, template } = s
    if (selectedIds.length < 3) return
    const sel = template.placements
      .filter(p => selectedIds.includes(p.id))
      .sort((a, b) => dir === 'horizontal' ? a.xMm - b.xMm : a.yMm - b.yMm)
    const first = dir === 'horizontal' ? sel[0].xMm : sel[0].yMm
    const last  = dir === 'horizontal' ? sel[sel.length - 1].xMm : sel[sel.length - 1].yMm
    const gap   = (last - first) / (sel.length - 1)
    set({
      ...withUndo(s),
      template: produce(template, d => {
        sel.forEach((orig, i) => {
          const p = d.placements.find(x => x.id === orig.id)!
          if (dir === 'horizontal') p.xMm = first + gap * i
          else p.yMm = first + gap * i
        })
      }),
      isDirty: true
    })
  },

  // ── Undo/Redo ─────────────────────────────────────────────────────────────
  undo: () => {
    const { past, template, future } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    set({
      past: past.slice(0, -1),
      future: [snap(template), ...future.slice(0, MAX_HIST - 1)],
      template: produce(template, d => { d.labelDesign = prev.labelDesign; d.placements = prev.placements }),
      isDirty: true,
      selectedIds: []
    })
  },

  redo: () => {
    const { future, template, past } = get()
    if (!future.length) return
    const next = future[0]
    set({
      future: future.slice(1),
      past: [...past.slice(-MAX_HIST), snap(template)],
      template: produce(template, d => { d.labelDesign = next.labelDesign; d.placements = next.placements }),
      isDirty: true,
      selectedIds: []
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
})
