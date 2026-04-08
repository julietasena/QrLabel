import { useRef, useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Handles two scroll behaviors shared by both canvas views:
 *
 * 1. **Restore** — on mount (or when containerSize changes) applies the saved
 *    scroll position. Retries on each resize until the container is large enough
 *    to reach the target. Falls back to centering when the saved position is (0, 0).
 *
 * 2. **Re-center on zoom** — after the first render, any zoom change scrolls the
 *    container back to the center of its content.
 */
export function useCanvasScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  savedPos: { x: number; y: number },
  containerSize: { w: number; h: number },
  zoom: number
): void {
  const savedPosRef = useRef(savedPos)
  const scrollAppliedRef = useRef(false)

  useEffect(() => {
    if (scrollAppliedRef.current) return
    const el = scrollRef.current; if (!el) return
    const { x, y } = savedPosRef.current
    if (x !== 0 || y !== 0) {
      el.scrollLeft = x
      el.scrollTop  = y
      if (el.scrollLeft >= x - 1 && el.scrollTop >= y - 1) scrollAppliedRef.current = true
    } else {
      el.scrollLeft = Math.max(0, (el.scrollWidth  - el.clientWidth)  / 2)
      el.scrollTop  = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
      scrollAppliedRef.current = true
    }
  }, [containerSize]) // eslint-disable-line

  const zoomMountRef = useRef(true)
  useEffect(() => {
    if (zoomMountRef.current) { zoomMountRef.current = false; return }
    const el = scrollRef.current; if (!el) return
    el.scrollLeft = Math.max(0, (el.scrollWidth  - el.clientWidth)  / 2)
    el.scrollTop  = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
  }, [zoom]) // eslint-disable-line
}
