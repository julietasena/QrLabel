import React from 'react'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { useUnits } from '../../hooks/useUnits'

export function LabelDesignProps() {
  const { template, updateLabelDesignSize, addQrBlock } = useTemplateStore(useShallow(s => ({
    template: s.template,
    updateLabelDesignSize: s.updateLabelDesignSize,
    addQrBlock: s.addQrBlock
  })))
  const u = useUnits()
  const ld = template.labelDesign

  return (
    <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="section-title" style={{ margin: '0 -10px' }}>Etiqueta (bounding box)</div>
      <NumberInput label={`Ancho (${u.label})`} value={u.toDisplay(ld.widthMm)}
        min={1} step={u.unit === 'px' ? 1 : 0.5}
        onChange={v => updateLabelDesignSize(u.fromDisplay(v), ld.heightMm)} />
      <NumberInput label={`Alto (${u.label})`} value={u.toDisplay(ld.heightMm)}
        min={1} step={u.unit === 'px' ? 1 : 0.5}
        onChange={v => updateLabelDesignSize(ld.widthMm, u.fromDisplay(v))} />

      <div className="section-title" style={{ margin: '0 -10px' }}>
        QR Blocks ({ld.qrBlocks.length})
      </div>
      <button className="btn-primary" onClick={addQrBlock}>+ Agregar QR Block</button>
      {ld.qrBlocks.length === 0 && (
        <p style={{ color: 'var(--text3)', fontSize: 11, textAlign: 'center', padding: '8px 0' }}>
          Sin bloques QR. Hacé clic en<br />"Agregar QR Block".
        </p>
      )}
    </div>
  )
}
