import React, { useState, useEffect, useRef } from 'react'

interface Props {
  label?: string
  value: number
  onChange: (v: number) => void
  onFocus?: () => void
  min?: number
  max?: number
  step?: number
  unit?: string
  disabled?: boolean
  style?: React.CSSProperties
}

export function NumberInput({ label, value, onChange, onFocus: onFocusProp, min, max, step = 0.01, unit, disabled, style }: Props) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync display when value changes externally (not while editing)
  useEffect(() => {
    if (!focused) setRaw(String(parseFloat(value.toFixed(4))))
  }, [value, focused])

  function commit() {
    setFocused(false)
    const parsed = parseFloat(raw)
    if (isNaN(parsed)) { setRaw(String(parseFloat(value.toFixed(4)))); return }
    let clamped = parsed
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    onChange(clamped)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, ...style }}>
      {label && <label>{label}</label>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          ref={inputRef}
          type="number"
          value={focused ? raw : parseFloat(value.toFixed(3))}
          onChange={e => setRaw(e.target.value)}
          onFocus={() => { setFocused(true); setRaw(String(parseFloat(value.toFixed(4)))); onFocusProp?.() }}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); inputRef.current?.blur() } }}
          step={step} min={min} max={max} disabled={disabled}
          style={{ flex: 1 }}
        />
        {unit && <span style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0 }}>{unit}</span>}
      </div>
    </div>
  )
}
