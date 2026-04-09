import React, { useEffect, useRef, useState } from 'react'
import type { PrintProgress } from '../../../../shared/schema'

interface Props { onClose: (finalProgress: PrintProgress) => void }

export function ProgressModal({ onClose }: Props) {
  const [progress, setProgress] = useState<PrintProgress>({
    currentPage: 0, totalPages: 1, currentLabel: '', currentNumber: 0, status: 'printing'
  })

  useEffect(() => {
    const remove = window.electronAPI.onPrintProgress(p => setProgress(p))
    return remove
  }, [])

  // Watchdog: if no progress event arrives within 30 s while printing,
  // transition to error so the modal doesn't freeze indefinitely.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    if (progress.status === 'printing' || progress.status === 'spooled') {
      watchdogRef.current = setTimeout(() => {
        setProgress(p => ({
          ...p,
          status: 'error',
          errorMessage: 'Sin respuesta del proceso de impresión (timeout 30 s). Verificá que la impresora esté disponible.'
        }))
      }, 30_000)
    }
    return () => { if (watchdogRef.current) clearTimeout(watchdogRef.current) }
  }, [progress])

  const pct = progress.totalPages > 0 ? Math.round(progress.currentPage / progress.totalPages * 100) : 0
  const { status } = progress
  const done = status === 'done'
  const cancelled = status === 'cancelled'
  const err = status === 'error'
  const paused = status === 'paused'
  const printing = status === 'printing'
  const spooled = status === 'spooled'
  const finished = done || cancelled

  async function handlePause() { await window.electronAPI.pausePrint() }
  async function handleResume() { await window.electronAPI.resumePrint() }
  async function handleCancel() { await window.electronAPI.cancelPrint() }

  return (
    <div className="overlay-backdrop">
      <div className="modal" style={{ minWidth: 440 }}>
        <h2 style={{ marginBottom: 16 }}>
          {printing && '🖨 Imprimiendo...'}
          {spooled && '🖨 Aguardando impresora...'}
          {paused && '⏸ En pausa'}
          {err && '⚠ Error de impresión'}
          {done && '✅ Impresión completada'}
          {cancelled && '❌ Cancelado'}
        </h2>

        {/* Progress bar */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 5 }}>
            <span>Página {progress.currentPage} / {progress.totalPages}</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 10, background: 'var(--bg3)', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 5, transition: 'width 0.4s ease',
              width: `${pct}%`,
              background: err ? 'var(--danger)' : done ? 'var(--success)' : paused ? 'var(--warn)' : 'var(--accent)'
            }} />
          </div>
        </div>

        {/* Spooled note */}
        {spooled && (
          <p style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 12 }}>
            Trabajo enviado a la cola. Aguardando confirmación de la impresora...
          </p>
        )}

        {/* Current label */}
        {progress.currentLabel && (
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
            Etiqueta actual: <span style={{ fontFamily: 'monospace', color: 'var(--text)' }}>{progress.currentLabel}</span>
          </div>
        )}

        {/* Error */}
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
            ✅ Se imprimieron {progress.currentPage} páginas correctamente.
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
