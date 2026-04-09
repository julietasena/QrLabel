import React from 'react'
import { panelContainer, sectionTitleInset } from './panelStyles'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { useUnits } from '../../hooks/useUnits'
import { useUndoOnFocus } from '../../hooks/useUndoOnFocus'
import { normalizeRotation } from '../../../../shared/units'
import type { Placement } from '../../../../shared/schema'

interface Props { placement: Placement }

export function PlacementProps({ placement }: Props) {
  const { updatePlacement, deletePlacement, duplicatePlacement, selectedIds } = useTemplateStore(useShallow(s => ({
    updatePlacement: s.updatePlacement,
    deletePlacement: s.deletePlacement,
    duplicatePlacement: s.duplicatePlacement,
    selectedIds: s.selectedIds
  })))
  const numberingMode = useTemplateStore(s => s.template.printConfig.numberingMode)
  const u = useUnits()

  const onFocusField = useUndoOnFocus(placement.id)
  const upd = (changes: Partial<Placement>) => updatePlacement(placement.id, changes, false)

  return (
    <div style={panelContainer}>
      <div className="section-title" style={sectionTitleInset}>
        Placement {selectedIds.length > 1 ? `(${selectedIds.length} sel.)` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberInput label={`X (${u.label})`} value={u.toDisplay(placement.xMm)}
          step={u.unit === 'cm' ? 0.01 : 0.1} onFocus={onFocusField}
          onChange={v => upd({ xMm: u.fromDisplay(v) })} />
        <NumberInput label={`Y (${u.label})`} value={u.toDisplay(placement.yMm)}
          step={u.unit === 'cm' ? 0.01 : 0.1} onFocus={onFocusField}
          onChange={v => upd({ yMm: u.fromDisplay(v) })} />
      </div>
      <NumberInput label="Rotación (°)" value={placement.rotationDeg}
        min={0} max={359} step={1} onFocus={onFocusField}
        onChange={v => upd({ rotationDeg: normalizeRotation(v) })} />
      <NumberInput label="Offset (#)" value={placement.numberOffset ?? 0}
        min={0} step={1}
        disabled={numberingMode === 'sequential'}
        onFocus={onFocusField}
        onChange={v => upd({ numberOffset: Math.max(0, Math.floor(v)) })} />
      {numberingMode === 'sequential' && (
        <p style={{ fontSize: 10, color: 'var(--text3)', margin: 0 }}>
          Activá "Con offset" en la sección Hoja para usar esta opción.
        </p>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={() => duplicatePlacement(placement.id)}>
          Duplicar
        </button>
        <button className="btn-danger" style={{ flex: 1 }} onClick={() => deletePlacement(placement.id)}>
          Eliminar
        </button>
      </div>
    </div>
  )
}
