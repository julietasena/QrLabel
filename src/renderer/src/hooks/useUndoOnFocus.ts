import { useRef, useEffect } from 'react'
import { useTemplateStore } from '../store/templateStore'

/**
 * Returns an `onFocus` handler that pushes a single undo snapshot the first
 * time any field is focused for a given item id. Subsequent focus events within
 * the same selection are ignored, so the entire editing session collapses into
 * one Ctrl+Z step. Resets automatically when `id` changes (new item selected).
 */
export function useUndoOnFocus(id: string): () => void {
  const pushedRef = useRef(false)
  useEffect(() => { pushedRef.current = false }, [id])
  return () => {
    if (pushedRef.current) return
    pushedRef.current = true
    useTemplateStore.getState().pushUndo()
  }
}
