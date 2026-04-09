import React from 'react'
import { panelContainer, sectionTitleInset } from './panelStyles'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { useUnits } from '../../hooks/useUnits'

export function LabelDesignProps() {
  const { labelDesign: ld, updateLabelDesignSize, addQrBlock } = useTemplateStore(useShallow(s => ({
    labelDesign: s.template.labelDesign,
    updateLabelDesignSize: s.updateLabelDesignSize,
    addQrBlock: s.addQrBlock,
  })))
  const u = useUnits()

  return (
    <div style={panelContainer}>
      <div className="section-title" style={sectionTitleInset}>Etiqueta </div>
      <NumberInput label={`Ancho (${u.label})`} value={u.toDisplay(ld.widthMm)}
        min={1} step={u.unit === 'cm' ? 0.1 : 0.5}
        onChange={v => updateLabelDesignSize(u.fromDisplay(v), ld.heightMm)} />
      <NumberInput label={`Alto (${u.label})`} value={u.toDisplay(ld.heightMm)}
        min={1} step={u.unit === 'cm' ? 0.1 : 0.5}
        onChange={v => updateLabelDesignSize(ld.widthMm, u.fromDisplay(v))} />

      <div className="section-title" style={sectionTitleInset}>
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
