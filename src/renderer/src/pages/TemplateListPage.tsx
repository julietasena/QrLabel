import React, { useEffect, useState, useMemo } from 'react'
import { FolderOpen, Pencil, Trash2, Clock, Printer } from 'lucide-react'
import { useTemplateStore } from '../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { formatPayload } from '../../../shared/numberFormat'
import type { TemplateListItem } from '../../../main/ipc/templateHandlers'

interface Props { onOpen: () => void }

export function TemplateListPage({ onOpen }: Props) {
  const { newTemplate, setTemplate, setFilename } = useTemplateStore(useShallow(s => ({
    newTemplate: s.newTemplate, setTemplate: s.setTemplate, setFilename: s.setFilename
  })))

  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'modified' | 'printed'>('modified')
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [lastPrintModal, setLastPrintModal] = useState<import('../../../shared/schema').Template | null>(null)

  useEffect(() => { loadList() }, [])

  async function loadList() {
    setLoading(true)
    const list = await window.electronAPI.listTemplates()
    setTemplates(list)
    setLoading(false)
  }

  async function handleOpen(name: string) {
    const res = await window.electronAPI.loadTemplate(name)
    if (!res.ok) { setError(res.error); loadList(); return }
    setTemplate(res.data, name)
    if (res.data.printHistory.records.length > 0) {
      setLastPrintModal(res.data)
    } else {
      onOpen()
    }
  }

  async function handleNew() {
    let name = newName.trim() || 'Nueva plantilla'
    // Auto-increment if name already taken ("Nueva plantilla" → "Nueva plantilla 2" → …)
    if (await window.electronAPI.templateExists(name)) {
      let i = 2
      while (await window.electronAPI.templateExists(`${name} ${i}`)) i++
      name = `${name} ${i}`
    }
    newTemplate(name)
    const state = useTemplateStore.getState()
    await window.electronAPI.saveTemplate(name, state.template)
    setFilename(name)
    setShowNew(false); setNewName('')
    onOpen()
  }

  async function handleDelete(name: string) {
    if (!confirm(`¿Eliminar "${name}"?`)) return
    await window.electronAPI.deleteTemplate(name)
    loadList()
  }

  async function handleRename(oldName: string) {
    const trimmed = renameVal.trim()
    if (!trimmed || trimmed === oldName) { setRenamingId(null); return }
    const res = await window.electronAPI.renameTemplate(oldName, trimmed)
    if (!res.ok) {
      setError(res.error ?? 'Error al renombrar')
      setRenamingId(null)  // close inline editor so user can retry via the pencil button
      loadList()
      return
    }
    setRenamingId(null); loadList()
  }

  const filtered = useMemo(() => {
    let list = templates.filter(t =>
      t.name.toLowerCase().includes(search.toLowerCase())
    )
    if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'modified') list = [...list].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    else if (sortBy === 'printed') list = [...list].sort((a, b) => (b.lastPrint ?? '').localeCompare(a.lastPrint ?? ''))
    return list
  }, [templates, search, sortBy])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--bg)', overflowY: 'auto', padding: '40px 20px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 36, marginBottom: 6 }}>🖨</div>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>QRLabel</h1>
        <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 4 }}>Diseñador de etiquetas QR numeradas</p>
      </div>

      <div style={{ width: '100%', maxWidth: 640 }}>
        {/* New template */}
        <div style={{ marginBottom: 16 }}>
          {showNew ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input autoFocus placeholder="Nombre de la plantilla" value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleNew()}
                style={{ flex: 1 }} />
              <button className="btn-primary" onClick={handleNew}>Crear</button>
              <button className="btn-secondary" onClick={() => { setShowNew(false); setNewName('') }}>Cancelar</button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => setShowNew(true)}
              style={{ width: '100%', justifyContent: 'center', padding: '9px' }}>
              + Nueva plantilla
            </button>
          )}
        </div>

        {/* Search + sort */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            placeholder="🔍  Buscar por nombre..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1 }} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            style={{ width: 'auto' }}>
            <option value="modified">↕ Modificación</option>
            <option value="name">↕ Nombre</option>
            <option value="printed">↕ Última impresión</option>
          </select>
        </div>

        {error && (
          <div style={{ color: 'var(--danger)', background: 'rgba(224,91,91,0.1)', borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12 }}>
            {error}
            <button className="btn-icon" onClick={() => setError(null)} style={{ float: 'right' }}>✕</button>
          </div>
        )}

        {loading && <p style={{ textAlign: 'center', color: 'var(--text2)' }}>Cargando...</p>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text3)', border: '1px dashed var(--border)', borderRadius: 8 }}>
            {search ? 'Sin resultados para tu búsqueda.' : 'No hay plantillas. Creá una nueva.'}
          </div>
        )}

        {filtered.map(t => (
          <div key={t.name} className="template-card">
            <div style={{ flexShrink: 0, display:'flex', alignItems:'center', paddingTop:2 }}><FolderOpen size={18} color="var(--accent)" strokeWidth={1.8} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {renamingId === t.name ? (
                <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                  onBlur={() => handleRename(t.name)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(t.name); if (e.key === 'Escape') setRenamingId(null) }}
                  style={{ width: '100%' }} />
              ) : (
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span>Modificado: {new Date(t.modifiedAt).toLocaleString('es-AR')}</span>
                {t.lastPrint && <span style={{display:'flex',alignItems:'center',gap:3}}><Printer size={10} color="var(--accent2)" strokeWidth={1.8}/>{new Date(t.lastPrint).toLocaleString('es-AR')}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button className="btn-icon" onClick={() => { setRenamingId(t.name); setRenameVal(t.name) }} title="Renombrar" style={{padding:'4px 5px'}}><Pencil size={14} color="var(--text2)" strokeWidth={1.8} /></button>
              <button className="btn-icon" onClick={() => handleDelete(t.name)} title="Eliminar" style={{padding:'4px 5px'}}><Trash2 size={14} color="#e05b5b" strokeWidth={1.8} /></button>
              <button className="btn-primary" onClick={() => handleOpen(t.name)} style={{ padding: '4px 12px', fontSize: 12 }}>Abrir</button>
            </div>
          </div>
        ))}
      </div>

      {/* Last print info modal on open */}
      {lastPrintModal && (
        <LastPrintModal
          template={lastPrintModal}
          onContinue={() => { setLastPrintModal(null); onOpen() }}
          onCancel={() => setLastPrintModal(null)}
        />
      )}
    </div>
  )
}

function LastPrintModal({ template, onContinue, onCancel }: { template: import('../../../shared/schema').Template; onContinue: () => void; onCancel: () => void }) {
  const records = template.printHistory.records
  const last = records[0]
  if (!last) { onContinue(); return null }

  const prevRecords = records.slice(1, 3)

  return (
    <div className="overlay-backdrop">
      <div className="modal" style={{ maxWidth: 480 }}>
        <h2>📋 Historial de impresión — {template.name}</h2>

        <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--accent)' }}>Última impresión</div>
          <div style={{ fontSize: 13, fontFamily: 'monospace', marginBottom: 4 }}>
            {formatPayload(last.start, last)} → {formatPayload(last.end, last)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span>Paso: {last.step}</span>
            <span>Padding: {last.padWidth}</span>
            <span>Prefijo: <code>{last.prefix || '—'}</code></span>
            <span>Sufijo: <code>{last.suffix || '—'}</code></span>
            <span>Total: {last.totalPrinted} etiq.</span>
            <span>Impresora: {last.printerName}</span>
            <span>Fecha: {new Date(last.printedAt).toLocaleString('es-AR')}</span>
          </div>
        </div>

        {prevRecords.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>Anteriores:</div>
            <div style={{ marginBottom: 14 }}>
              {prevRecords.map((r, i) => (
                <div key={i} style={{ fontSize: 11, padding: '4px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'monospace' }}>{formatPayload(r.start, r)} → {formatPayload(r.end, r)}</span>
                  <span style={{ color: 'var(--text3)' }}>{new Date(r.printedAt).toLocaleDateString('es-AR')} · {r.totalPrinted} etiq.</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn-primary" onClick={onContinue}>Abrir plantilla</button>
        </div>
      </div>
    </div>
  )
}
