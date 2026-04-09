import { useRef, useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Handles two scroll behaviours shared by both canvas views:
 *
 * 1. **Restore** — applies the saved scroll position once the scroll container
 *    has its real dimensions from ResizeObserver (not the default {800, 600}).
 *    Uses useLayoutEffect so the scroll is set before the browser paints.
 *    Falls back to centering when savedPos is (0, 0).
 *
 * 2. **Re-center on zoom** — after the initial restore, any zoom change scrolls
 *    the container back to the center of its content.
 *
 * Implementation notes:
 *   - `mountedRef` starts false. The first useLayoutEffect fire is always on
 *     mount with the default containerSize {800, 600}. We skip it by checking
 *     mountedRef and setting it to true. Every subsequent fire is after
 *     ResizeObserver has delivered a real size — safe to restore then.
 *   - We do NOT try to restore at the default {800, 600} state because the inner
 *     div is artificially wide at that point; the scroll "sticks" at a position
 *     that gets browser-clamped once the real container size arrives, corrupting
 *     the saved position via the handleScroll event.
 */
export function useCanvasScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  savedPos: { x: number; y: number },
  containerSize: { w: number; h: number },
  zoom: number
): void {
  // Capture the savedPos value at mount time (never updated — only needed once).
  const savedPosRef = useRef(savedPos)

  // Whether we have seen at least one containerSize update (i.e. past the mount render).
  const mountedRef = useRef(false)

  // Whether the scroll has been successfully restored.
  const restoredRef = useRef(false)

  useLayoutEffect(() => {
    if (!mountedRef.current) {
      // First call is on mount with the default containerSize {800,600} — skip.
      mountedRef.current = true
      return
    }
    if (restoredRef.current) return
    const el = scrollRef.current; if (!el) return

    const { x, y } = savedPosRef.current
    if (x !== 0 || y !== 0) {
      el.scrollLeft = x
      el.scrollTop  = y
      // Accept partial success: mark done when at least one axis applied.
      if (el.scrollLeft >= x - 1 && el.scrollTop >= y - 1) restoredRef.current = true
    } else {
      // No saved position — center the view.
      el.scrollLeft = Math.max(0, (el.scrollWidth  - el.clientWidth)  / 2)
      el.scrollTop  = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
      restoredRef.current = true
    }
  }, [containerSize]) // eslint-disable-line

  // Re-center on zoom changes (after the initial restore).
  const zoomMountRef = useRef(true)
  useLayoutEffect(() => {
    if (zoomMountRef.current) { zoomMountRef.current = false; return }
    const el = scrollRef.current; if (!el) return
    el.scrollLeft = Math.max(0, (el.scrollWidth  - el.clientWidth)  / 2)
    el.scrollTop  = Math.max(0, (el.scrollHeight - el.clientHeight) / 2)
  }, [zoom]) // eslint-disable-line
}
