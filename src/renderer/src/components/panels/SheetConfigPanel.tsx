import React from 'react'
import { panelContainer, sectionTitleInset, fieldGroup } from './panelStyles'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { useUnits } from '../../hooks/useUnits'
import { PAGE_PRESETS, pageDisplayDims } from '../../../../shared/schema'
import type { PagePreset, Unit, NumberingMode } from '../../../../shared/schema'

export function SheetConfigPanel() {
  const { page, unit, numberingMode, updatePage, updateUnit, updatePrintConfig } = useTemplateStore(useShallow(s => ({
    page: s.template.page,
    unit: s.template.unit,
    numberingMode: s.template.printConfig.numberingMode,
    updatePage: s.updatePage,
    updateUnit: s.updateUnit,
    updatePrintConfig: s.updatePrintConfig,
  })))
  const u = useUnits()
  const step = u.unit === 'cm' ? 0.1 : 1

  return (
    <div style={panelContainer}>
      <div className="section-title" style={sectionTitleInset}>Hoja</div>

      <div style={fieldGroup}>
        <label>Tamaño</label>
        <select value={page.preset} onChange={e => {
          const preset = e.target.value as PagePreset
          if (preset !== 'custom') {
            const p = PAGE_PRESETS[preset as Exclude<PagePreset, 'custom'>]
            updatePage({ preset, widthMm: p.widthMm, heightMm: p.heightMm, orientation: 'portrait' })
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

      <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', marginTop: 4 }}>
        {([false, true] as const).map(isLandscape => {
          const active = isLandscape ? page.orientation === 'landscape' : page.orientation !== 'landscape'
          return (
            <button key={String(isLandscape)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                if (!active) updatePage({ ...page, orientation: isLandscape ? 'landscape' : 'portrait' })
              }}
              style={{
                flex: 1, border: 'none', borderRadius: 0, cursor: 'pointer',
                fontSize: 11, padding: '5px 8px',
                background: active ? 'var(--accent)' : 'var(--bg3)',
                color: active ? '#fff' : 'var(--text2)',
                fontWeight: active ? 600 : 400
              }}>
              {isLandscape ? 'Horizontal' : 'Vertical'}
            </button>
          )
        })}
      </div>

      {page.preset === 'custom' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
          <NumberInput label={`Ancho (${u.label})`} value={u.toDisplay(page.widthMm)} min={u.toDisplay(10)} step={step}
            onChange={v => updatePage({ ...page, widthMm: u.fromDisplay(v) })} />
          <NumberInput label={`Alto (${u.label})`} value={u.toDisplay(page.heightMm)} min={u.toDisplay(10)} step={step}
            onChange={v => updatePage({ ...page, heightMm: u.fromDisplay(v) })} />
        </div>
      )}

      <div style={{ padding: '4px 0', borderTop: '1px solid var(--border)', marginTop: 4 }}>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>
          {(() => { const d = pageDisplayDims(page); return `${u.fmt(d.w)} × ${u.fmt(d.h)} ${u.label}` })()}
        </div>
        {page.orientation === 'landscape' && (
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            Físico: {u.fmt(page.widthMm)} × {u.fmt(page.heightMm)} {u.label}
          </div>
        )}
      </div>

      <div className="section-title" style={sectionTitleInset}>Unidades</div>
      <select value={unit} onChange={e => updateUnit(e.target.value as Unit)}>
        <option value="mm">Milímetros (mm)</option>
        <option value="cm">Centímetros (cm)</option>
      </select>

      <div className="section-title" style={{ margin: '0 -10px', marginTop: 4 }}>Numeración</div>
      <div style={{ display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {(['sequential', 'offset'] as NumberingMode[]).map(mode => (
          <button key={mode}
            onMouseDown={e => e.preventDefault()}
            onClick={() => updatePrintConfig({ numberingMode: mode })}
            style={{
              flex: 1, border: 'none', borderRadius: 0, cursor: 'pointer',
              fontSize: 11, padding: '5px 8px',
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
