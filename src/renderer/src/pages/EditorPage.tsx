import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTemplateStore } from '../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { MainToolbar } from '../components/toolbar/MainToolbar'
import { LabelDesignerCanvas } from '../components/editor/LabelDesignerCanvas'
import { SheetLayoutCanvas } from '../components/editor/SheetLayoutCanvas'
import { PropertiesPanel } from '../components/panels/PropertiesPanel'
import { PrintDialog } from '../components/dialogs/PrintDialog'
import { ProgressModal } from '../components/dialogs/ProgressModal'
import { HUD } from '../components/editor/HUD'
import type { PrintJobConfig, PrintRecord, PrintProgress } from '../../../shared/schema'
import { countLabels } from '../../../shared/numberFormat'

interface Props { onBack: () => void }

export function EditorPage({ onBack }: Props) {
  const { template, isDirty, currentFilename, setDirty, setTemplate } = useTemplateStore(useShallow(s => ({
    template: s.template, isDirty: s.isDirty, currentFilename: s.currentFilename,
    setDirty: s.setDirty, setTemplate: s.setTemplate
  })))
  const mode = useTemplateStore(s => s.mode)

  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // U7 — keep OS window title in sync: "● TemplateName — QRLabel" when dirty
  useEffect(() => {
    const title = `${isDirty ? '● ' : ''}${template.name} — QRLabel`
    window.electronAPI.setTitle(title)
    return () => { window.electronAPI.setTitle('QRLabel') }
  }, [isDirty, template.name])

  // F6 — debounced auto-save: 30 s after the last change, silently persist
  // Only applies to templates that already have a filename (previously saved)
  useEffect(() => {
    if (!currentFilename) return
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current)
    autoSaveRef.current = setTimeout(async () => {
      const s = useTemplateStore.getState()
      if (!s.isDirty || !s.currentFilename) return
      const res = await window.electronAPI.saveTemplate(s.currentFilename, s.template)
      if (res.ok) s.setDirty(false)
    }, 30_000)
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current) }
  }, [template, currentFilename])

  const [showPrint, setShowPrint] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [toastType, setToastType] = useState<'info' | 'error'>('info')
  const pendingPrintRef = useRef<{ config: PrintJobConfig; labelCount: number } | null>(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')

  function showToast(msg: string, type: 'info' | 'error' = 'info', ms = 3000) {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(null), ms)
  }

  const handleSave = useCallback(async () => {
    const s = useTemplateStore.getState()
    const name = s.currentFilename ?? s.template.name
    const res = await window.electronAPI.saveTemplate(name, s.template)
    if (res.ok) { s.setDirty(false); showToast('✓ Guardado') }
    else showToast(res.error ?? 'Error al guardar', 'error')
  }, [])

  const handleSaveAs = useCallback(() => {
    const s = useTemplateStore.getState()
    setSaveAsName(s.currentFilename ?? s.template.name)
    setSaveAsOpen(true)
  }, [])

  async function doSaveAs() {
    const name = saveAsName.trim()
    if (!name) return
    const s = useTemplateStore.getState()
    const currentName = s.currentFilename ?? s.template.name
    // Only warn about overwrite when saving under a DIFFERENT name that already exists
    if (name !== currentName) {
      const exists = await window.electronAPI.templateExists(name)
      if (exists && !confirm(`Ya existe una plantilla llamada "${name}". ¿Sobreescribir?`)) return
    }
    const res = await window.electronAPI.saveTemplate(name, s.template)
    if (res.ok) { s.setFilename(name); s.setDirty(false); showToast(`✓ Guardado como "${name}"`) }
    else showToast(res.error ?? 'Error al guardar', 'error')
    setSaveAsOpen(false)
  }

  useEffect(() => {
    const remove = window.electronAPI.onMenuEvent(ev => {
      const s = useTemplateStore.getState()
      if (ev === 'menu:save') handleSave()
      else if (ev === 'menu:save-as') handleSaveAs()
      else if (ev === 'menu:undo') s.undo()
      else if (ev === 'menu:redo') s.redo()
      else if (ev === 'menu:zoom-in') s.zoomIn()
      else if (ev === 'menu:zoom-out') s.zoomOut()
      else if (ev === 'menu:zoom-reset') s.resetZoom()
      else if (ev === 'menu:new' || ev === 'menu:open') {
        if (s.isDirty && !confirm('Hay cambios sin guardar. ¿Continuar?')) return
        onBack()
      }
    })
    return remove
  }, [handleSave, handleSaveAs, onBack])

  async function handleStartPrint(config: PrintJobConfig) {
    setShowPrint(false)
    const { start, end, printConfig } = config
    const labelCount = countLabels({ start, end, step: printConfig.step, padWidth: printConfig.padWidth, prefix: printConfig.prefix, suffix: printConfig.suffix })
    pendingPrintRef.current = { config, labelCount }
    setShowProgress(true)
    const res = await window.electronAPI.startPrint(config)
    if (!res.ok) showToast(res.error ?? 'Error al iniciar impresión', 'error')
  }

  async function handleProgressClose(finalProgress: PrintProgress) {
    setShowProgress(false)
    const pending = pendingPrintRef.current
    pendingPrintRef.current = null
    if (!pending) return
    const { config, labelCount } = pending
    const { start, end, printerName, printConfig, placements } = config
    const { numberingMode } = config.printConfig
    const actualPrinted = finalProgress.status === 'done'
      ? (numberingMode === 'offset' ? labelCount * placements.length : labelCount)
      : Math.max(0, finalProgress.currentPage - 1) * placements.length
    const record: PrintRecord = {
      start, end,
      step: printConfig.step, padWidth: printConfig.padWidth, prefix: printConfig.prefix, suffix: printConfig.suffix,
      printedAt: new Date().toISOString(),
      totalPrinted: actualPrinted,
      printerName
    }
    const t = useTemplateStore.getState().template
    const name = currentFilename ?? t.name
    // After a successful print, advance previewNumber to the next expected start so the
    // canvas preview and the print dialog both default to the correct continuation number.
    const nextPreview = finalProgress.status === 'done'
      ? end + printConfig.step
      : t.printConfig.previewNumber
    const updated = {
      ...t,
      printConfig: { ...t.printConfig, previewNumber: nextPreview },
      printHistory: { records: [record, ...t.printHistory.records].slice(0, 50) }
    }
    setTemplate(updated, name)
    await window.electronAPI.saveTemplate(name, updated)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
        <button className="btn-icon" onClick={() => {
          if (isDirty && !confirm('Hay cambios sin guardar. ¿Salir?')) return
          onBack()
        }} title="Volver a plantillas" style={{ borderRadius: 0, borderRight: '1px solid var(--border)', padding: '0 14px', height: '100%' }}><ArrowLeft size={16} color="#9898b8" strokeWidth={1.8} /></button>
        <div style={{ flex: 1 }}>
          <MainToolbar onSave={handleSave} onOpenPrint={() => setShowPrint(true)} />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {mode === 'label' ? <LabelDesignerCanvas /> : <SheetLayoutCanvas />}
        </div>
        <PropertiesPanel />
      </div>

      <StatusBar />
      <HUD />

      {toast && (
        <div className="toast" style={{ borderLeftColor: toastType === 'error' ? 'var(--danger)' : 'var(--success)' }}>
          {toast}
          <button className="btn-icon" onClick={() => setToast(null)} style={{ marginLeft: 8 }}>✕</button>
        </div>
      )}

      {showPrint && <PrintDialog onClose={() => setShowPrint(false)} onStartPrint={handleStartPrint} />}
      {showProgress && <ProgressModal onClose={handleProgressClose} />}

      {saveAsOpen && (
        <div className="overlay-backdrop">
          <div className="modal" style={{ maxWidth: 360 }}>
            <h2>Guardar como</h2>
            <div style={{ marginBottom: 14 }}>
              <label>Nombre de la plantilla</label>
              <input
                type="text"
                value={saveAsName}
                onChange={e => setSaveAsName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doSaveAs(); else if (e.key === 'Escape') setSaveAsOpen(false) }}
                autoFocus
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setSaveAsOpen(false)}>Cancelar</button>
              <button className="btn-primary" onClick={doSaveAs} disabled={!saveAsName.trim()}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBar() {
  const { template, zoom, mode, selectedIds } = useTemplateStore(useShallow(s => ({
    template: s.template, zoom: s.zoom, mode: s.mode, selectedIds: s.selectedIds
  })))
  return (
    <div style={{ height: 22, background: 'var(--bg2)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 14, fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>
      <span>{mode === 'label' ? '🏷 Etiqueta' : '📄 Hoja'}</span>
      <span>Zoom: {Math.round(zoom * 100)}%</span>
      <span>{mode === 'label' ? template.labelDesign.qrBlocks.length : template.placements.length} {mode === 'label' ? 'QR blocks' : 'placements'}</span>
      {selectedIds.length > 1 && <span style={{ color: 'var(--accent)' }}>{selectedIds.length} seleccionados</span>}
      <span>{template.page.widthMm}×{template.page.heightMm}mm ({template.page.preset})</span>
      <span>{template.unit}</span>
    </div>
  )
}
