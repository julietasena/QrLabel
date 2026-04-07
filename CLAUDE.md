# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QRLabel is an **Electron + React + TypeScript** desktop app for designing and printing numbered QR code labels on pre-printed paper sheets. Targets Windows 10/11 for production; development can be done on any OS.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev mode with hot reload (opens Electron window)
npm run build        # Compile TypeScript + Vite bundle
npm run dist         # Build Windows .exe installer → dist/QRLabel Setup 1.0.0.exe  (requires resources/icon.ico)
npm run typecheck    # Type-check without emitting (tsc --noEmit)
```

There are no test or lint scripts.

## Runtime Paths (Windows)

- Templates: `%APPDATA%\QRLabel\templates\*.json`
- Logs: `%APPDATA%\QRLabel\logs\main.log` (via `electron-log`)

## Keyboard Shortcuts

Handled as native menu events forwarded via IPC (`menu:*`) to the renderer:

| Shortcut | Action |
|----------|--------|
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+D | Duplicate selection |
| Delete | Delete selection |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |

## Architecture

### Process Separation (Electron)

Three distinct processes communicate via IPC:

- **`src/main/`** — Node.js main process. Manages window creation, native menus, file I/O, and printing. IPC handlers in `src/main/ipc/` expose template CRUD and print queue. Templates are stored as JSON in `%APPDATA%\QRLabel\templates\*.json`.
- **`src/preload/index.ts`** — Context bridge. Exposes a safe `window.electronAPI.*` API to the renderer (never leaks Node APIs).
- **`src/renderer/src/`** — Chromium/React renderer. No direct Node.js access; all main-process operations go through `window.electronAPI`.
- **`src/shared/`** — Code shared between main and renderer: Zod schemas, unit conversion, number formatting, QR generation.

### State Management

Single Zustand store (`src/renderer/src/store/templateStore.ts`) with Immer for immutable mutations. Contains:
- Template data (the document being edited)
- UI state (`EditorMode`: `'label' | 'sheet'`, independent `labelZoom`/`sheetZoom`, scroll positions, `showRuler`, `showGrid`)
- `HUDState` — live position/size/rotation values shown during drag/scale/rotate
- 50-snapshot undo/redo history
- Dirty flag for unsaved changes
- Module-level `clipboard` variable (copy/paste of `QrBlock`s or `Placement`s — intentionally **not** part of undo snapshots)

The store exports `textOverhang(ld: LabelDesign)` — a utility that estimates how far text extends beyond label boundaries (used for placement clamping).

### Canvas Editing (Konva)

Two separate Konva canvases in the editor:
- **`LabelDesignerCanvas`** — Edits QR block position/size/rotation within a single label cell. Each `QrBlockNode` uses a `textRef` + `useLayoutEffect` to measure actual rendered text width and center it precisely, keeping the `Transformer` bounding box tight (max of QR size vs real text width).
- **`SheetLayoutCanvas`** — Arranges label placements on the page. Handles rotation-aware bounds clamping via `rotatedPlacementBounds()`. Drag bounds account for text overhang via `textOverhang()`.

Both support drag, scale, and rotate via Konva `Transformer`.

### Data Model

All types are defined and validated in `src/shared/schema.ts` using Zod. Key types: `Template`, `Page`, `Grid`, `QrBlock`, `Placement`, `PrintConfig`, `PrintRecord`. Use `createDefaultTemplate()` for new templates. `MAX_LABELS = 5000` caps the print range.

`QrBlock` fields of note:
- `wrapText: boolean` (default `false`) — controls whether the text label under the QR wraps to multiple lines. Both the Konva canvas and the print HTML respect this field identically so the preview always matches output.
- `rotationDeg`: validated as `gte(0).lt(360)` (floats allowed; `< 360` not `<= 359` to handle float precision). Always normalize with `% 360` after `snapDeg()` calls.

`Placement` fields of note:
- `numberOffset: number` (int, min 0) — per-placement offset added to the base number when `numberingMode = 'offset'`. In `'sequential'` mode all placements advance together; in `'offset'` mode each placement shows `baseNumber + placement.numberOffset`.

`PrintConfig` fields of note:
- `step: number` (int, positive, default `1`) — increment between consecutive label numbers.
- `previewNumber: number` (int, min 0, default `1`) — the number shown in the canvas live preview.
- `numberingMode`: `'sequential'` (default) — labels numbered consecutively across placements; `'offset'` — each placement independently adds its `numberOffset` to the current base number, allowing non-sequential layouts (e.g., multiple label series on one sheet).

### Print Flow

1. User opens `PrintDialog` → selects printer, start/end numbers.
2. Main process spawns one hidden `BrowserWindow` per page.
3. `src/main/print/pageRenderer.ts` generates HTML with **inline SVG** (not data-URL) QR codes — Chromium rejects nested data-URLs in print. `pageSize` in `WebContentsPrintOptions` is in **microns** (1 mm = 1000 µm).
4. On the last page, `placements` and `payloads` are sliced to the actual count — no padding with the last number.
5. Each page has **3 retry attempts** (2 s backoff) and a **15 s** HTML-load timeout. On failure the job pauses; the user can resume (retries same page) or cancel.
6. Print progress tracked via IPC events; supports pause/resume/cancel.
7. History of last 50 print jobs stored per template.

### Text rendering (single-line vs wrap)

When `wrapText=false`:
- **Konva**: `<Text>` has no `width` prop (auto-sizes to content). `textX` is computed via `textRef.getTextWidth()` in `useLayoutEffect` to center over the QR.
- **Print HTML**: text div uses full label width (`left: -block.xMm; width: labelWidthMm`) so long single-line text doesn't get clipped by the label's `overflow:hidden`.

When `wrapText=true`:
- **Konva**: `width={sp}`, `wrap='word'`, `align='center'`.
- **Print HTML**: `width: block.sizeMm`, `white-space: normal`.

### Unit conversion

All stored values are in **millimetres**. `src/shared/units.ts` provides the key conversions:
- `mmToKonva(mm, zoom)` / `konvaToMm(px, zoom)` — converts between mm data model and Konva canvas pixels at 96 DPI base (`MM_TO_PX_BASE ≈ 3.78 px/mm`).
- `mmToUnit` / `unitToMm` — converts between mm and the template's display unit (`mm | cm | px`).
- `PT_TO_MM = 25.4 / 72` — typographic point to mm, used in `textOverhang()`.

### Number formatting

`src/shared/numberFormat.ts` provides utilities used by both renderer and print:
- `formatPayload(num, cfg)` — formats a number into the QR payload string (`prefix + zero-padded + suffix`).
- `previewPayloadFromConfig(cfg)` — shorthand for formatting `cfg.previewNumber`.
- `countLabels(cfg)` — computes how many labels a given `start/end/step` range produces.
- `validatePrintRange(start, end, step)` — returns an error string or `null`.

`PAGE_PRESETS` in `schema.ts` maps preset names (`A4`, `Legal`, `Oficio`) to `{ widthMm, heightMm }`. `custom` is a valid `PagePreset` enum value but has no entry in `PAGE_PRESETS`.

### QR generation & caching

`src/shared/qr.ts` maintains two in-memory caches (payload → SVG string, payload → data-URL). Use `generateQrSvgString` for print HTML (inline SVG) and `generateQrDataUrl` for the Konva canvas preview. Call `clearQrCache()` when the print config changes in a way that alters payloads (the store does this automatically). Error correction level is fixed at `'M'` with margin 4.

### Multi-select & alignment

`selectedIds: string[]` in the store holds the currently selected `QrBlock` or `Placement` IDs (context-dependent on `EditorMode`). The `AlignToolbar` component drives `alignQrBlocks` / `alignPlacements` and `distributeQrBlocks` / `distributePlacements` store actions. Bulk moves go through `updateManyQrBlocks` / `updateManyPlacements` (single undo snapshot for the batch).

### Placement clamping

`updatePlacement` in the store and `dragBoundFunc` in `SheetLayoutCanvas` both call `textOverhang(ld)` to tighten Y bounds so text that protrudes below/above the label boundary also stays within the page. The approximation is axis-aligned; rotated labels are conservative.

### Navigation & focus

`App.tsx` is a simple two-view router: **TemplateListPage** ↔ **EditorPage**. Native menu events (`menu:save`, `menu:undo`, etc.) are sent from main to renderer via IPC.

The `window:focus` IPC handler in `src/main/index.ts` does `blur()` → `focus()` → `webContents.focus()` to reinitialize Chromium's IME context on Windows after Konva canvas usage. This only fires when navigating **back to the list** (`view === 'list'`) to avoid a flicker when opening a template.

`window:confirm-close` IPC is sent by the renderer when there are unsaved changes; main registers a one-time `close` listener that prompts the user, then calls this handler to remove the listener and close cleanly.

## Path Aliases

- `@renderer/*` → `src/renderer/src/*`
- `@shared/*` → `src/shared/*`

Configured in `electron.vite.config.ts` and the relevant `tsconfig.web.json`.
