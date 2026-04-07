import React from 'react'
const EMBEDDED = ['Roboto Mono', 'Roboto', 'Courier New']
const SYSTEM   = ['Arial', 'Arial Black', 'Calibri', 'Consolas', 'Georgia', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Verdana']
interface Props { value: string; onChange: (v: string) => void }
export function FontSelector({ value, onChange }: Props) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <optgroup label="Embebidas ★">
        {EMBEDDED.map(f => <option key={f} value={f}>{f}</option>)}
      </optgroup>
      <optgroup label="Sistema">
        {SYSTEM.map(f => <option key={f} value={f}>{f}</option>)}
      </optgroup>
    </select>
  )
}
