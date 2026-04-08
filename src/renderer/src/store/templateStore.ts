import { create } from 'zustand'
import { createUISlice } from './uiSlice'
import { createTemplateSlice } from './templateSlice'
import type { UISlice } from './uiSlice'
import type { TemplateSlice } from './templateSlice'

// Re-export types that consumers import from this module
export type { EditorMode, HUDState } from './uiSlice'
// Re-export textOverhang for SheetLayoutCanvas (pure geometry utility)
export { textOverhang } from '../../../shared/geometry'

export type TemplateStore = UISlice & TemplateSlice

export const useTemplateStore = create<TemplateStore>()((...a) => ({
  ...createUISlice(...a),
  ...createTemplateSlice(...a),
}))
