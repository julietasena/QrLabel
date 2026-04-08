import type { CSSProperties } from 'react'

/** Outer wrapper for every property panel. */
export const panelContainer: CSSProperties = {
  padding: '0 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

/** Applied to every `section-title` div to bleed the heading to panel edges. */
export const sectionTitleInset: CSSProperties = { margin: '0 -10px' }

/** Label + control stacked vertically with a tight gap. */
export const fieldGroup: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
}
