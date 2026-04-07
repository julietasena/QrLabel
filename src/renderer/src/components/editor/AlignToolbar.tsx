import React from 'react'
import { useTemplateStore } from '../../store/templateStore'
import { useShallow } from 'zustand/react/shallow'

export function AlignToolbar() {
  const { mode, alignQrBlocks, distributeQrBlocks, alignPlacements, distributePlacements, selectedIds } = useTemplateStore(useShallow(s => ({
    mode: s.mode,
    alignQrBlocks: s.alignQrBlocks,
    distributeQrBlocks: s.distributeQrBlocks,
    alignPlacements: s.alignPlacements,
    distributePlacements: s.distributePlacements,
    selectedIds: s.selectedIds
  })))
  const n = selectedIds.length

  const align = (axis: 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV') =>
    mode === 'label' ? alignQrBlocks(axis) : alignPlacements(axis)
  const distribute = (dir: 'horizontal' | 'vertical') =>
    mode === 'label' ? distributeQrBlocks(dir) : distributePlacements(dir)

  const btn = (label: string, title: string, onClick: () => void, disabled = false) => (
    <button className="btn-secondary" onClick={onClick} disabled={disabled} title={title}
      style={{ fontSize: 11, padding: '3px 8px' }}>
      {label}
    </button>
  )

  return (
    <div style={{
      background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
      padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, flexWrap: 'wrap'
    }}>
      <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 4 }}>Alinear ({n} sel.):</span>
      {btn('⇤ Izq', 'Alinear borde izquierdo', () => align('left'))}
      {btn('⇥ Der', 'Alinear borde derecho',   () => align('right'))}
      {btn('⇡ Arr', 'Alinear borde superior',  () => align('top'))}
      {btn('⇣ Aba', 'Alinear borde inferior',  () => align('bottom'))}
      {btn('↔ C.H', 'Centrar horizontalmente', () => align('centerH'))}
      {btn('↕ C.V', 'Centrar verticalmente',   () => align('centerV'))}
      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>Distribuir:</span>
      {btn('↔ H', 'Distribuir horizontalmente', () => distribute('horizontal'), n < 3)}
      {btn('↕ V', 'Distribuir verticalmente',   () => distribute('vertical'),   n < 3)}
    </div>
  )
}
