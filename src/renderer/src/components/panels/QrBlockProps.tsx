import React from 'react'
import { panelContainer, sectionTitleInset, fieldGroup } from './panelStyles'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { FontSelector } from '../common/FontSelector'
import { useUnits } from '../../hooks/useUnits'
import { useUndoOnFocus } from '../../hooks/useUndoOnFocus'
import { normalizeRotation } from '../../../../shared/units'
import type { QrBlock } from '../../../../shared/schema'

interface Props { block: QrBlock }

export function QrBlockProps({ block }: Props) {
  const { updateQrBlock, deleteQrBlock, duplicateQrBlock } = useTemplateStore(useShallow(s => ({
    updateQrBlock: s.updateQrBlock,
    deleteQrBlock: s.deleteQrBlock,
    duplicateQrBlock: s.duplicateQrBlock
  })))
  const u = useUnits()

  const onFocusField = useUndoOnFocus(block.id)
  const upd = (changes: Partial<QrBlock>) => updateQrBlock(block.id, changes, false)

  return (
    <div style={panelContainer}>
      <div className="section-title" style={sectionTitleInset}>QR Block</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberInput label={`X (${u.label})`} value={u.toDisplay(block.xMm)}
          step={u.unit === 'px' ? 1 : 0.1} onFocus={onFocusField}
          onChange={v => upd({ xMm: u.fromDisplay(v) })} />
        <NumberInput label={`Y (${u.label})`} value={u.toDisplay(block.yMm)}
          step={u.unit === 'px' ? 1 : 0.1} onFocus={onFocusField}
          onChange={v => upd({ yMm: u.fromDisplay(v) })} />
      </div>

      <NumberInput label={`Tamaño (${u.label})`} value={u.toDisplay(block.sizeMm)}
        min={u.unit === 'px' ? 20 : 5} step={u.unit === 'px' ? 1 : 0.5} onFocus={onFocusField}
        onChange={v => upd({ sizeMm: Math.max(1, u.fromDisplay(v)) })} />

      <NumberInput label="Rotación (°)" value={block.rotationDeg}
        min={0} max={359} step={1} onFocus={onFocusField}
        onChange={v => upd({ rotationDeg: normalizeRotation(v) })} />

      <div className="section-title" style={sectionTitleInset}>Texto</div>

      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, display: 'flex' }}>
        <input type="checkbox" checked={block.showText}
          onChange={e => upd({ showText: e.target.checked })} />
        Mostrar texto bajo QR
      </label>

      {block.showText && (
        <>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, display: 'flex' }}>
            <input type="checkbox" checked={block.wrapText}
              onChange={e => upd({ wrapText: e.target.checked })} />
            Partir texto en múltiples líneas
          </label>

          <div style={fieldGroup}>
            <label>Posición</label>
            <select value={block.textPosition}
              onChange={e => upd({ textPosition: e.target.value as 'above'|'below' })}>
              <option value="above">Arriba</option>
              <option value="below">Abajo</option>
            </select>
          </div>

          <NumberInput label={`Offset texto (${u.label})`}
            value={u.toDisplay(block.textOffsetMm)} min={0} step={0.1} onFocus={onFocusField}
            onChange={v => upd({ textOffsetMm: Math.max(0, u.fromDisplay(v)) })} />

          <NumberInput label="Tamaño fuente (pt)"
            value={block.fontSize} min={4} max={72} step={0.5} onFocus={onFocusField}
            onChange={v => upd({ fontSize: v })} />

          <div style={fieldGroup}>
            <label>Fuente</label>
            <FontSelector value={block.fontFamily} onChange={v => upd({ fontFamily: v })} />
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={() => duplicateQrBlock(block.id)}>
          Duplicar
        </button>
        <button className="btn-danger" style={{ flex: 1 }} onClick={() => deleteQrBlock(block.id)}>
          Eliminar
        </button>
      </div>
    </div>
  )
}
