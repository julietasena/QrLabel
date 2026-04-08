import type { StateCreator } from 'zustand'

export type EditorMode = 'label' | 'sheet'

export interface HUDState {
  type: 'drag' | 'scale' | 'rotate'
  values: Record<string, number | string>
  screenX: number
  screenY: number
}

const ZOOM_MIN = 0.15
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25

export interface UISlice {
  // State
  mode: EditorMode
  zoom: number
  labelZoom: number
  sheetZoom: number
  selectedIds: string[]
  hud: HUDState | null
  showRuler: boolean
  showGrid: boolean
  labelScrollPos: { x: number; y: number }
  sheetScrollPos: { x: number; y: number }

  // Actions
  setMode: (m: EditorMode) => void
  setZoom: (z: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setLabelScrollPos: (x: number, y: number) => void
  setSheetScrollPos: (x: number, y: number) => void
  setSelected: (id: string | null) => void
  setSelectedIds: (ids: string[]) => void
  toggleSelected: (id: string) => void
  setHUD: (h: HUDState | null) => void
  toggleRuler: () => void
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  mode: 'label',
  zoom: 1,
  labelZoom: 1,
  sheetZoom: 1,
  selectedIds: [],
  hud: null,
  showRuler: true,
  showGrid: true,
  labelScrollPos: { x: 0, y: 0 },
  sheetScrollPos: { x: 0, y: 0 },

  setMode: m => set(s => ({
    mode: m,
    selectedIds: [],
    zoom: m === 'label' ? s.labelZoom : s.sheetZoom
  })),
  setZoom: z => set(s => {
    const v = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
    return { zoom: v, ...(s.mode === 'label' ? { labelZoom: v } : { sheetZoom: v }) }
  }),
  zoomIn: () => set(s => {
    const v = Math.min(ZOOM_MAX, Math.round((s.zoom + ZOOM_STEP) * 100) / 100)
    return { zoom: v, ...(s.mode === 'label' ? { labelZoom: v } : { sheetZoom: v }) }
  }),
  zoomOut: () => set(s => {
    const v = Math.max(ZOOM_MIN, Math.round((s.zoom - ZOOM_STEP) * 100) / 100)
    return { zoom: v, ...(s.mode === 'label' ? { labelZoom: v } : { sheetZoom: v }) }
  }),
  resetZoom: () => set(s => ({
    zoom: 1,
    ...(s.mode === 'label' ? { labelZoom: 1 } : { sheetZoom: 1 })
  })),
  setLabelScrollPos: (x, y) => set({ labelScrollPos: { x, y } }),
  setSheetScrollPos: (x, y) => set({ sheetScrollPos: { x, y } }),
  setSelected: id => set({ selectedIds: id ? [id] : [] }),
  setSelectedIds: ids => set({ selectedIds: ids }),
  toggleSelected: id => set(s => ({
    selectedIds: s.selectedIds.includes(id)
      ? s.selectedIds.filter(x => x !== id)
      : [...s.selectedIds, id]
  })),
  setHUD: hud => set({ hud }),
  toggleRuler: () => set(s => ({ showRuler: !s.showRuler })),
})
