import React, { useEffect, useRef, useState } from 'react'
import type { PrintProgress } from '../../../../shared/schema'

interface Props { onClose: (finalProgress: PrintProgress) => void }

export function ProgressModal({ onClose }: Props) {
  const [progress, setProgress] = useState<PrintProgress>({
    currentPage: 0, totalPages: 1, currentLabel: '', currentNumber: 0,
    confirmedPages: 0, confirmedLabels: 0, status: 'printing'
  })

  useEffect(() => {
    const remove = window.electronAPI.onPrintProgress(p => setProgress(p))
    return remove
  }, [])

  // Stall detector: warns when confirmedPages hasn't advanced in 3 minutes.
  // Unlike a simple timeout, this clock resets ONLY on real progress — so it
  // correctly fires even when retries keep sending 'spooled' without advancing.
  const stallSince = useRef<{ confirmedPages: number; time: number }>({ confirmedPages: 0, time: Date.now() })
  const [stallWarning, setStallWarning] = useState(false)

  useEffect(() => {
    const { confirmedPages, status } = progress

    if (confirmedPages > stallSince.current.confirmedPages) {
      stallSince.current = { confirmedPages, time: Date.now() }
      setStallWarning(false)
      return
    }
    if (status !== 'printing' && status !== 'spooled') {
      setStallWarning(false)
      return
    }
    const STALL_MS = 180_000
    const elapsed = Date.now() - stallSince.current.time
    if (elapsed >= STALL_MS) { setStallWarning(true); return }
    const t = setTimeout(() => setStallWarning(true), STALL_MS - elapsed)
    return () => clearTimeout(t)
  }, [progress])

  const { status, confirmedPages, currentPage, totalPages } = progress

  // Two-layer progress bar:
  //   Solid   = confirmed pages (physically printed)
  //   Stripe  = current page in progress (render/spooling)
  const confirmedPct = totalPages > 0 ? Math.round(confirmedPages / totalPages * 100) : 0
  const currentPct   = totalPages > 0 ? Math.round(currentPage    / totalPages * 100) : 0

  const done      = status === 'done'
  const cancelled = status === 'cancelled'
  const err       = status === 'error'
  const paused    = status === 'paused'
  const printing  = status === 'printing'
  const spooled   = status === 'spooled'
  const finished  = done || cancelled

  const barColor = err ? 'var(--danger)' : done ? 'var(--success)' : paused ? 'var(--warn)' : 'var(--accent)'

  async function handlePause()  { await window.electronAPI.pausePrint() }
  async function handleResume() { await window.electronAPI.resumePrint() }
  async function handleCancel() { await window.electronAPI.cancelPrint() }

  return (
    <div className="overlay-backdrop">
      <div className="modal" style={{ minWidth: 440 }}>
        <h2 style={{ marginBottom: 16 }}>
          {printing  && '🖨 Imprimiendo...'}
          {spooled   && '🖨 Enviando a impresora...'}
          {paused    && '⏸ En pausa'}
          {err       && '⚠ Error de impresión'}
          {done      && '✅ Impresión completada'}
          {cancelled && '❌ Cancelado'}
        </h2>

        {/* Progress bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 5 }}>
            <span>
              {confirmedPages > 0
                ? `Enviada ${confirmedPages} / ${totalPages}`
                : (printing || spooled) && currentPage > 0
                  ? `Procesando ${currentPage} / ${totalPages}`
                  : `0 / ${totalPages}`}
            </span>
            <span>{confirmedPct}%</span>
          </div>
          <div style={{ height: 10, background: 'var(--bg3)', borderRadius: 5, overflow: 'hidden', position: 'relative' }}>
            {/* Confirmed (solid) */}
            <div style={{
              height: '100%', borderRadius: 5, transition: 'width 0.4s ease',
              width: `${confirmedPct}%`,
              background: barColor
            }} />
            {/* In-progress stripe (translucent), visible when current page is ahead of confirmed */}
            {(printing || spooled) && currentPct > confirmedPct && (
              <div style={{
                position: 'absolute', top: 0,
                left: `${confirmedPct}%`,
                width: `${currentPct - confirmedPct}%`,
                height: '100%',
                background: 'rgba(100,160,255,0.28)',
                transition: 'width 0.4s ease'
              }} />
            )}
          </div>
        </div>

        {/* Spooled note */}
        {spooled && (
          <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
            Trabajo enviado a la cola de la impresora.
          </p>
        )}

        {/* Stall warning */}
        {stallWarning && (printing || spooled) && (
          <div style={{ background: 'rgba(255,180,0,0.1)', border: '1px solid var(--warn)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--warn)', marginBottom: 12 }}>
            ⚠ Sin avance en 3 minutos. Verificá que la impresora esté encendida y disponible.
          </div>
        )}

        {/* Current label */}
        {progress.currentLabel && (
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
            Etiqueta actual: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{progress.currentLabel}</span>
          </div>
        )}

        {/* Error message */}
        {err && progress.errorMessage && (
          <div style={{ background: 'rgba(224,91,91,0.1)', border: '1px solid var(--danger)', borderRadius: 4, padding: '8px 10px', fontSize: 11, color: 'var(--danger)', marginBottom: 12 }}>
            {progress.errorMessage}
          </div>
        )}

        {/* Paused note */}
        {paused && !err && (
          <p style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 12 }}>
            ⏸ Impresión pausada — hacé clic en Reanudar para continuar.
          </p>
        )}

        {/* Done summary */}
        {done && (
          <p style={{ fontSize: 11, color: 'var(--success)', marginBottom: 12 }}>
            ✅ Se enviaron {progress.confirmedPages} páginas a la impresora ({progress.confirmedLabels} etiquetas).
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {finished && <button className="btn-primary" onClick={() => onClose(progress)}>Cerrar</button>}
          {(printing || spooled || paused || err) && (
            <button className="btn-danger" onClick={handleCancel}>Cancelar</button>
          )}
          {(printing || spooled) && !err && (
            <button className="btn-secondary" onClick={handlePause}>⏸ Pausar</button>
          )}
          {(paused || err) && (
            <button className="btn-primary" onClick={handleResume}>▶ Reanudar</button>
          )}
        </div>
      </div>
    </div>
  )
}
