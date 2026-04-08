import { useEffect } from 'react'
import type { RefObject } from 'react'
import type Konva from 'konva'

/**
 * Wires a Konva Transformer to its target Group whenever `condition` is true.
 * Call with `isSelected` (PlacementNode) or `showTransformer` (QrBlockNode).
 */
export function useTransformerAttach(
  condition: boolean,
  trRef: RefObject<Konva.Transformer | null>,
  groupRef: RefObject<Konva.Group | null>
): void {
  useEffect(() => {
    if (!condition || !trRef.current || !groupRef.current) return
    trRef.current.nodes([groupRef.current])
    trRef.current.getLayer()?.batchDraw()
  }, [condition]) // eslint-disable-line
}
