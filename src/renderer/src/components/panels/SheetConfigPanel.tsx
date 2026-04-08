import React from 'react'
import { panelContainer, sectionTitleInset, fieldGroup } from './panelStyles'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { PAGE_PRESETS } from '../../../../shared/schema'
import type { PagePreset, Unit, NumberingMode } from '../../../../shared/schema'

export function SheetConfigPanel() {
  const { template, updatePage, updateUnit, updatePrintConfig } = useTemplateStore(useShallow(s => ({
    template: s.template,
    updatePage: s.updatePage,
    updateUnit: s.updateUnit,
    updatePrintConfig: s.updatePrintConfig
  })))
  const { page, unit } = template
  const numberingMode = template.printConfig.numberingMode

  return (
    <div style={panelContainer}>
      <div className="section-title" style={sectionTitleInset}>Hoja</div>

      <div style={fieldGroup}>
        <label>Tamaño</label>
        <select value={page.preset} onChange={e => {
          const preset = e.target.value as PagePreset
          if (preset !== 'custom') {
            const p = PAGE_PRESETS[preset as Exclude<PagePreset, 'custom'>]
            updatePage({ preset, widthMm: p.widthMm, heightMm: p.heightMm })
          } else {
            updatePage({ ...page, preset: 'custom' })
          }
        }}>
          <option value="A4">A4 (210 × 297 mm)</option>
          <option value="Legal">Legal (215.9 × 355.6 mm)</option>
          <option value="Oficio">Oficio (216 × 330 mm)</option>
          <option value="custom">Personalizado</option>
        </select>
      </div>

      {page.preset === 'custom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <NumberInput label="Ancho (mm)" value={page.widthMm} min={10} max={1000}
            onChange={v => updatePage({ ...page, widthMm: v })} />
          <NumberInput label="Alto (mm)" value={page.heightMm} min={10} max={1000}
            onChange={v => updatePage({ ...page, heightMm: v })} />
        </div>
      )}

      <div style={{ padding: '4px 0', borderTop: '1px solid var(--border)', marginTop: 2 }}>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
          {page.widthMm} × {page.heightMm} mm
        </div>
      </div>

      <div className="section-title" style={sectionTitleInset}>Unidades</div>
      <select value={unit} onChange={e => updateUnit(e.target.value as Unit)}>
        <option value="mm">Milímetros (mm)</option>
        <option value="cm">Centímetros (cm)</option>
        <option value="px">Píxeles (px)</option>
      </select>

      <div className="section-title" style={{ margin: '0 -10px', marginTop: 4 }}>Numeración</div>
      <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {(['sequential', 'offset'] as NumberingMode[]).map(mode => (
          <button key={mode}
            onMouseDown={e => e.preventDefault()}
            onClick={() => updatePrintConfig({ numberingMode: mode })}
            style={{
              flex: 1, border: 'none', borderRadius: 0, cursor: 'pointer',
              fontSize: 11, padding: '5px 0',
              background: numberingMode === mode ? 'var(--accent)' : 'var(--bg3)',
              color: numberingMode === mode ? '#fff' : 'var(--text2)',
              fontWeight: numberingMode === mode ? 600 : 400
            }}>
            {mode === 'sequential' ? 'Continuo' : 'Con offset'}
          </button>
        ))}
      </div>
      {numberingMode === 'offset' && (
        <p style={{ fontSize: 10, color: 'var(--text3)', margin: 0 }}>
          Cada placement avanza en paralelo. Configurá el offset en cada placement.
        </p>
      )}

      <p style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
        Tip: usá Ctrl+A para seleccionar todos los placements y las herramientas de alineación.
      </p>
    </div>
  )
}
