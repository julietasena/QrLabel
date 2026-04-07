import React from 'react'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { QrBlockProps } from './QrBlockProps'
import { LabelDesignProps } from './LabelDesignProps'
import { PlacementProps } from './PlacementProps'
import { PrintConfigPanel } from './PrintConfigPanel'
import { SheetConfigPanel } from './SheetConfigPanel'

export function PropertiesPanel() {
  const { mode, selectedIds, template } = useTemplateStore(useShallow(s => ({
    mode: s.mode, selectedIds: s.selectedIds, template: s.template
  })))
  const selectedId = selectedIds[0] ?? null

  const selectedQrBlock = mode === 'label'
    ? template.labelDesign.qrBlocks.find(b => b.id === selectedId) ?? null
    : null
  const selectedPlacement = mode === 'sheet'
    ? template.placements.find(p => p.id === selectedId) ?? null
    : null

  return (
    <div style={{ width: 240, flexShrink: 0, background: 'var(--bg2)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text3)', textTransform: 'uppercase' }}>
        Propiedades
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '6px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Always show PrintConfigPanel — it's the format config */}
        <PrintConfigPanel />

        <div style={{ borderTop: '1px solid var(--border)' }} />

        {mode === 'label' && selectedQrBlock && <QrBlockProps block={selectedQrBlock} />}
        {mode === 'label' && !selectedQrBlock && <LabelDesignProps />}
        {mode === 'sheet' && selectedPlacement && <PlacementProps placement={selectedPlacement} />}
        {mode === 'sheet' && !selectedPlacement && <SheetConfigPanel />}
      </div>
    </div>
  )
}
