import React from 'react'
import {
  Undo2, Redo2, ZoomIn, ZoomOut,
  Plus, Save, Printer, Tag, LayoutGrid,
  Clock, Eye, EyeOff
} from 'lucide-react'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'
import { formatPayload } from '../../../../shared/numberFormat'

// ── Reusable icon button ──────────────────────────────────────────────────────
function IBtn({
  icon: Icon, onClick, title, active, disabled, variant = 'default', size = 15
}: {
  icon: React.ElementType
  onClick?: () => void
  title?: string
  active?: boolean
  disabled?: boolean
  variant?: 'default' | 'danger' | 'success'
  size?: number
}) {
  const [hov, setHov] = React.useState(false)

  const fgColor = disabled
    ? 'var(--text3)'
    : active
      ? 'var(--accent)'
      : hov
        ? variant === 'danger'   ? 'var(--danger)'
        : variant === 'success'  ? 'var(--success)'
        : 'var(--text)'
      : 'var(--text2)'

  const bgColor = hov && !disabled
    ? variant === 'danger' ? 'rgba(224,91,91,0.12)'
    : active ? 'var(--accent-glow)'
    : 'rgba(255,255,255,0.05)'
    : active ? 'rgba(124,106,247,0.06)'
    : 'transparent'

  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: bgColor, border: 'none', borderRadius: 5,
        padding: '6px 8px', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.13s', opacity: disabled ? 0.35 : 1, flexShrink: 0,
      }}
    >
      <Icon size={size} color={fgColor} strokeWidth={1.8} />
    </button>
  )
}

function Sep() {
  return <div style={{ width: 1, height: 22, background: 'var(--border-subtle)', flexShrink: 0, margin: '0 1px' }} />
}

function ModeBtn({ label, icon: Icon, active, onClick }: { label: string; icon: React.ElementType; active: boolean; onClick: () => void }) {
  const [hov, setHov] = React.useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: '4px 11px', borderRadius: 5, border: 'none', cursor: 'pointer',
        background: active ? 'var(--accent)' : hov ? 'rgba(255,255,255,0.07)' : 'transparent',
        color: active ? '#fff' : hov ? 'var(--text)' : 'var(--text2)',
        fontSize: 13, fontFamily: 'inherit',
        display: 'flex', alignItems: 'center', gap: 6,
        transition: 'all 0.13s', flexShrink: 0,
      }}>
      <Icon size={13} strokeWidth={1.8} />
      {label}
    </button>
  )
}

export function MainToolbar({ onSave, onOpenPrint }: { onSave: () => void; onOpenPrint: () => void }) {
  const s = useTemplateStore(useShallow(s => ({
    template:     s.template,
    mode:         s.mode,
    zoom:         s.zoom,
    isDirty:      s.isDirty,
    showRuler:    s.showRuler,
    canUndo:      s.canUndo,
    canRedo:      s.canRedo,
    setMode:      s.setMode,
    zoomIn:       s.zoomIn,
    zoomOut:      s.zoomOut,
    resetZoom:    s.resetZoom,
    undo:         s.undo,
    redo:         s.redo,
    addQrBlock:   s.addQrBlock,
    addPlacement: s.addPlacement,
    toggleRuler:  s.toggleRuler,
  })))

  const lastPrint = s.template.printHistory.records[0] ?? null
  const lastLabel = lastPrint
    ? `${formatPayload(lastPrint.start, lastPrint)} → ${formatPayload(lastPrint.end, lastPrint)}`
    : null

  const [zoomHov, setZoomHov] = React.useState(false)

  return (
    <div style={{
      height: 46, background: 'var(--bg2)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center',
      gap: 1, padding: '0 8px', flexShrink: 0, overflowX: 'auto',
    }}>
      {/* Template name */}
      <span style={{
        fontSize: 13, fontWeight: 600, color: 'var(--text)',
        maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flexShrink: 0, paddingRight: 6,
      }}>
        {s.template.name}{s.isDirty ? ' ●' : ''}
      </span>

      <Sep />

      {/* Mode toggle */}
      <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', borderRadius: 7, padding: 2, gap: 1, flexShrink: 0 }}>
        <ModeBtn label="Etiqueta" icon={Tag}        active={s.mode === 'label'} onClick={() => s.setMode('label')} />
        <ModeBtn label="Hoja"     icon={LayoutGrid}  active={s.mode === 'sheet'} onClick={() => s.setMode('sheet')} />
      </div>

      <Sep />

      {/* Add */}
      <IBtn icon={Plus}
        onClick={s.mode === 'label' ? s.addQrBlock : s.addPlacement}
        title={s.mode === 'label' ? 'Agregar QR Block' : 'Agregar Placement'}
        size={16} />

      <Sep />

      {/* Undo / Redo */}
      <IBtn icon={Undo2} onClick={s.undo} disabled={!s.canUndo()} title="Deshacer (Ctrl+Z)" />
      <IBtn icon={Redo2} onClick={s.redo} disabled={!s.canRedo()} title="Rehacer (Ctrl+Y)" />

      <Sep />

      {/* Zoom */}
      <IBtn icon={ZoomOut} onClick={s.zoomOut} title="Alejar (Ctrl+−)" />
      <button
        onClick={s.resetZoom} title="Zoom 100% (Ctrl+0)"
        onMouseEnter={() => setZoomHov(true)} onMouseLeave={() => setZoomHov(false)}
        style={{
          background: zoomHov ? 'rgba(255,255,255,0.07)' : 'transparent',
          border: '1px solid var(--border-subtle)',
          borderRadius: 5, padding: '3px 8px', fontSize: 12,
          cursor: 'pointer', color: 'var(--text2)',
          minWidth: 46, textAlign: 'center',
          transition: 'all 0.13s', flexShrink: 0, fontFamily: 'inherit',
        }}
      >
        {Math.round(s.zoom * 100)}%
      </button>
      <IBtn icon={ZoomIn} onClick={s.zoomIn} title="Acercar (Ctrl+=)" />

      <Sep />

      {/* Ruler toggle */}
      <IBtn
        icon={s.showRuler ? EyeOff : Eye}
        onClick={s.toggleRuler}
        title={s.showRuler ? 'Ocultar reglas' : 'Mostrar reglas'}
        active={s.showRuler}
      />

      {/* Last print badge */}
      {lastLabel && (
        <>
          <Sep />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: 'var(--text3)',
            maxWidth: 230, overflow: 'hidden', flexShrink: 1,
          }} title={`Última impresión: ${lastLabel} — ${new Date(lastPrint!.printedAt).toLocaleString('es-AR')}`}>
            <Clock size={11} color="var(--accent2)" strokeWidth={1.8} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {lastLabel}
            </span>
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Save */}
      <SaveBtn onClick={onSave} isDirty={s.isDirty} />

      {/* Print */}
      <PrintBtn onClick={onOpenPrint} />
    </div>
  )
}

function SaveBtn({ onClick, isDirty }: { onClick: () => void; isDirty: boolean }) {
  const [hov, setHov] = React.useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: hov ? 'rgba(255,255,255,0.07)' : 'transparent',
        border: `1px solid ${hov ? 'rgba(124,106,247,0.5)' : 'var(--border-subtle)'}`,
        borderRadius: 6, padding: '5px 11px', fontSize: 13,
        cursor: 'pointer', color: hov ? 'var(--text)' : 'var(--text2)',
        transition: 'all 0.13s', flexShrink: 0, fontFamily: 'inherit', marginLeft: 4,
      }}>
      <Save size={13} color={hov ? 'var(--accent)' : 'var(--text2)'} strokeWidth={1.8} />
      Guardar{isDirty ? ' *' : ''}
    </button>
  )
}

function PrintBtn({ onClick }: { onClick: () => void }) {
  const [hov, setHov] = React.useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        background: hov ? 'var(--accent2)' : 'var(--accent)',
        border: 'none', borderRadius: 6, padding: '5px 13px',
        fontSize: 13, cursor: 'pointer', color: '#fff',
        transition: 'background 0.13s', flexShrink: 0, fontFamily: 'inherit', marginLeft: 6,
      }}>
      <Printer size={13} strokeWidth={1.8} />
      Imprimir
    </button>
  )
}
