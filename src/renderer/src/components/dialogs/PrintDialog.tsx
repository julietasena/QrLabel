import React, { useState, useEffect } from 'react'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { NumberInput } from '../common/NumberInput'
import { formatPayload, countLabels, validatePrintRange, computePageCount, computeTotalLabels } from '../../../../shared/numberFormat'
import { MAX_LABELS } from '../../../../shared/schema'
import type { PrintJobConfig } from '../../../../shared/schema'

interface Props {
  onClose: () => void
  onStartPrint: (config: PrintJobConfig) => void
}

export function PrintDialog({ onClose, onStartPrint }: Props) {
  const { printConfig, printHistory, placements, labelDesign, page } = useTemplateStore(useShallow(s => ({
    printConfig: s.template.printConfig,
    printHistory: s.template.printHistory,
    placements: s.template.placements,
    labelDesign: s.template.labelDesign,
    page: s.template.page,
  })))
  const lastRecord = printHistory.records[0] ?? null

  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [printerName, setPrinterName] = useState('')
  // previewNumber is the canonical "next start" — kept in sync with the canvas preview
  // and updated automatically after each successful print (see EditorPage.handleProgressClose).
  const [start, setStart] = useState(() => printConfig.previewNumber)
  const [end, setEnd]     = useState(() => printConfig.previewNumber + printConfig.step * 99)
  const [error, setError] = useState<string | null>(null)

  const { padWidth, prefix, suffix, step, numberingMode } = printConfig

  useEffect(() => {
    window.electronAPI.getPrinters().then(ps => {
      setPrinters(ps)
      const def = ps.find(p => p.isDefault) ?? ps[0]
      if (def) setPrinterName(def.name)
    })
  }, [])

  const labelCount  = countLabels({ start, end, step, padWidth, prefix, suffix })
  const pageCount   = computePageCount(labelCount, placements.length, numberingMode)
  const totalLabels = computeTotalLabels(labelCount, placements.length || 1, numberingMode)
  const previewFirst = formatPayload(start, { padWidth, prefix, suffix })
  const previewLast  = labelCount > 1
    ? formatPayload(end, { padWidth, prefix, suffix })
    : null
  const overLimit = labelCount > MAX_LABELS

  // Validation
  const noQrBlocks = labelDesign.qrBlocks.length === 0
  const noPlacements = placements.length === 0
  const canPrint = !overLimit && labelCount > 0 && !!printerName && !noQrBlocks && !noPlacements

  function handlePrint() {
    const e = validatePrintRange(start, end, step)
    if (e) { setError(e); return }
    if (overLimit)    { setError(`Máximo ${MAX_LABELS} etiquetas por trabajo`); return }
    if (noPlacements) { setError('No hay placements en la hoja — andá al Modo Hoja y agregá placements'); return }
    if (noQrBlocks)   { setError('La etiqueta no tiene QR blocks — andá al Modo Etiqueta y agregá uno'); return }
    if (!printerName) { setError('Seleccioná una impresora'); return }
    onStartPrint({ labelDesign, placements, page, printConfig, printerName, start, end })
  }

  return (
    <div className="overlay-backdrop">
      <div className="modal" style={{ maxWidth: 520 }}>
        <h2>🖨 Imprimir</h2>

        {/* Warnings */}
        {noQrBlocks && (
          <div style={{ background: 'rgba(224,91,91,0.15)', border: '1px solid var(--danger)', borderRadius: 5, padding: '7px 12px', marginBottom: 12, fontSize: 11, color: 'var(--danger)' }}>
            ⚠ La etiqueta no tiene QR blocks. Agregá al menos uno en <strong>Modo Etiqueta</strong>.
          </div>
        )}
        {noPlacements && (
          <div style={{ background: 'rgba(224,91,91,0.15)', border: '1px solid var(--danger)', borderRadius: 5, padding: '7px 12px', marginBottom: 12, fontSize: 11, color: 'var(--danger)' }}>
            ⚠ No hay placements en la hoja. Agregá al menos uno en <strong>Modo Hoja</strong>.
          </div>
        )}

        {/* Last print */}
        {lastRecord && (
          <div style={{ background: 'var(--bg3)', borderLeft: '3px solid var(--accent)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 11 }}>
            <strong>Última impresión: </strong>
            <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>
              {formatPayload(lastRecord.start, lastRecord)} → {formatPayload(lastRecord.end, lastRecord)}
            </span>
            <span style={{ color: 'var(--text2)' }}>
              {' '}· {lastRecord.totalPrinted} etiq. · {new Date(lastRecord.printedAt).toLocaleString('es-AR')}
            </span>
            <div style={{ marginTop: 5 }}>
              <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => {
                setStart(lastRecord.end + lastRecord.step)
                setEnd(lastRecord.end + lastRecord.step * 100)
              }}>
                Continuar desde {formatPayload(lastRecord.end + lastRecord.step, lastRecord)}
              </button>
            </div>
          </div>
        )}

        {/* Format (read-only summary) */}
        <div style={{ background: 'var(--bg3)', borderRadius: 5, padding: '6px 10px', marginBottom: 12, fontSize: 11, color: 'var(--text2)' }}>
          <strong style={{ color: 'var(--text)' }}>Formato: </strong>
          prefijo=<code style={{ color: 'var(--accent)' }}>{prefix || '—'}</code>
          {'  '}padding=<code style={{ color: 'var(--accent)' }}>{padWidth}</code>
          {'  '}sufijo=<code style={{ color: 'var(--accent)' }}>{suffix || '—'}</code>
          {'  '}paso=<code style={{ color: 'var(--accent)' }}>{step}</code>
          <span style={{ marginLeft: 6, color: 'var(--text3)' }}>(panel derecho → Formato QR)</span>
          {'  '}Modo: <strong style={{ color: 'var(--accent)' }}>{numberingMode === 'offset' ? 'Con offset' : 'Continuo'}</strong>
          <span style={{ color: 'var(--text3)' }}> (panel derecho → Hoja)</span>
        </div>

        {/* Printer */}
        <div style={{ marginBottom: 10 }}>
          <label>Impresora</label>
          <select value={printerName} onChange={e => setPrinterName(e.target.value)}>
            {printers.length === 0 && <option value="">Cargando impresoras...</option>}
            {printers.map(p => (
              <option key={p.name} value={p.name}>
                {p.name}{p.isDefault ? ' ★' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <NumberInput label="Desde" value={start} min={0} step={1}
            onChange={v => { const s = Math.max(0, Math.floor(v)); setStart(s); if (end < s) setEnd(s) }} />
          <NumberInput label="Hasta (inclusive)" value={end} min={start} step={1}
            onChange={v => setEnd(Math.max(start, Math.floor(v)))} />
        </div>

        {/* Preview */}
        <div style={{ background: 'var(--bg3)', borderRadius: 5, padding: '8px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{previewFirst}</span>
            {previewLast && previewLast !== previewFirst && (
              <span style={{ color: 'var(--text2)' }}>
                {' '}→ ... →{' '}
                <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{previewLast}</span>
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, marginTop: 3, color: overLimit ? 'var(--warn)' : 'var(--text2)' }}>
            {numberingMode === 'offset'
              ? `${pageCount} páginas · ${totalLabels} etiquetas`
              : `${totalLabels} etiquetas · ${pageCount} páginas`}
            {placements.length > 0 ? ` (${placements.length} por hoja)` : ''}
            {overLimit ? ` — ⚠ máximo ${MAX_LABELS}` : ''}
          </div>
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', background: 'rgba(224,91,91,0.1)', borderRadius: 4, padding: '7px 10px', fontSize: 11, marginBottom: 10 }}>
            ⚠ {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" onClick={handlePrint} disabled={!canPrint}>
            Imprimir {totalLabels > 0 ? `${totalLabels} etiquetas` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
