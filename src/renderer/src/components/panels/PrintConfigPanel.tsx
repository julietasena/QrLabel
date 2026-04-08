import React from 'react'
import { panelContainer, sectionTitleInset, fieldGroup } from './panelStyles'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { previewPayloadFromConfig } from '../../../../shared/numberFormat'

export function PrintConfigPanel() {
  const { printConfig, updatePrintConfig } = useTemplateStore(useShallow(s => ({
    printConfig: s.template.printConfig,
    updatePrintConfig: s.updatePrintConfig
  })))

  const preview = previewPayloadFromConfig(printConfig)

  return (
    <div style={panelContainer}>
      <div className="section-title" style={sectionTitleInset}>Formato QR (preview)</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div style={fieldGroup}>
          <label>Prefijo</label>
          <input value={printConfig.prefix} onChange={e => updatePrintConfig({ prefix: e.target.value })}
            placeholder="ej: GGC" />
        </div>
        <div style={fieldGroup}>
          <label>Sufijo</label>
          <input value={printConfig.suffix} onChange={e => updatePrintConfig({ suffix: e.target.value })}
            placeholder="ej: -A" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumberInput label="Padding dígitos" value={printConfig.padWidth}
          min={0} max={10} step={1} onChange={v => updatePrintConfig({ padWidth: Math.floor(v) })} />
        <NumberInput label="Paso" value={printConfig.step}
          min={1} step={1} onChange={v => updatePrintConfig({ step: Math.max(1, Math.floor(v)) })} />
      </div>

      <NumberInput label="Nro. preview" value={printConfig.previewNumber}
        min={0} step={1} onChange={v => updatePrintConfig({ previewNumber: Math.floor(v) })} />

      <div style={{
        background: 'var(--bg)', borderRadius: 4, padding: '6px 8px',
        fontSize: 11, fontFamily: 'monospace', color: 'var(--accent)',
        border: '1px solid var(--border)', wordBreak: 'break-all'
      }}>
        {preview}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text3)', margin: 0 }}>
        Este formato se usa en la preview del canvas y se aplica al imprimir.
      </p>
    </div>
  )
}
