import React from 'react'
import { useTemplateStore } from '../../store/templateStore'

export function HUD() {
  const hud = useTemplateStore(s => s.hud)
  const unit = useTemplateStore(s => s.template.unit)
  if (!hud) return null

  let lines: string[] = []
  if (hud.type === 'drag') {
    lines = [`X: ${Number(hud.values.X).toFixed(2)} ${unit}`, `Y: ${Number(hud.values.Y).toFixed(2)} ${unit}`]
  } else if (hud.type === 'scale') {
    lines = [`⊞ ${Number(hud.values.size).toFixed(2)} ${unit}`, `${hud.values.pct}%`]
  } else {
    lines = [`↺ ${hud.values.deg}°`]
  }

  return (
    <div className="hud" style={{ left: hud.screenX, top: hud.screenY }}>
      {lines.map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}
