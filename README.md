# QRLabel — Diseñador de etiquetas QR numeradas

App de escritorio Windows para diseñar e imprimir QRs numerados sobre papel preimpreso.

---

## Requisitos

- Node.js 18+
- npm 9+
- Windows 10/11 (para producción)
- Para desarrollo: cualquier OS

---

## Instalación y desarrollo

```bash
# 1. Instalar dependencias
npm install

# 2. Modo desarrollo (hot reload)
npm run dev
```

---

## Build — instalador .exe

```bash
# 1. Compilar TypeScript + Vite
npm run build

# 2. Generar instalador NSIS
npm run dist
```

El instalador queda en `dist/QRLabel Setup 1.0.0.exe`.

> **Nota:** Para generar el icono `.ico`, colocá un archivo `resources/icon.ico` (256×256 px) antes de correr `npm run dist`. Si no existe, electron-builder usa el icono default.

---

## Estructura del proyecto

```
src/
├── main/                   # Proceso principal Electron (Node.js)
│   ├── index.ts            # Entry point, crea ventana
│   ├── ipc/
│   │   ├── templateHandlers.ts   # CRUD plantillas + listado impresoras
│   │   └── printHandlers.ts      # Cola de impresión por páginas
│   └── print/
│       └── pageRenderer.ts       # Genera HTML de cada página de impresión
│
├── preload/
│   └── index.ts            # Bridge seguro renderer ↔ main (contextBridge)
│
├── renderer/               # App React
│   ├── index.html
│   └── src/
│       ├── App.tsx
│       ├── pages/
│       │   ├── TemplateListPage.tsx
│       │   └── EditorPage.tsx
│       ├── components/
│       │   ├── editor/         # Konva canvas (LabelDesigner + SheetLayout)
│       │   ├── panels/         # Panel de propiedades
│       │   ├── toolbar/        # Barra de herramientas
│       │   └── dialogs/        # PrintDialog + ProgressModal
│       ├── store/
│       │   └── templateStore.ts  # Zustand store + undo/redo
│       └── hooks/              # useUnits, useGrid, useTransformHUD
│
└── shared/                 # Código compartido main+renderer
    ├── schema.ts            # Tipos TypeScript + validación Zod
    ├── units.ts             # Conversiones mm/cm/px
    ├── numberFormat.ts      # Formato de payload (prefix+pad+suffix)
    └── qr.ts                # Generación SVG de QR con caché
```

---

## Atajos de teclado

| Acción | Atajo |
|---|---|
| Deshacer | `Ctrl+Z` |
| Rehacer | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Guardar | `Ctrl+S` |
| Duplicar elemento | `Ctrl+D` |
| Eliminar seleccionado | `Delete` |
| Zoom in | `Ctrl+=` |
| Zoom out | `Ctrl+-` |
| Reset zoom | `Ctrl+0` |

---

## Plantillas guardadas

Las plantillas se guardan en:
```
%APPDATA%\QRLabel\templates\*.json
```

Los logs de la aplicación están en:
```
%APPDATA%\QRLabel\logs\main.log
```

---

## Schema JSON de plantilla (v1)

```json
{
  "version": 1,
  "name": "Mi plantilla",
  "unit": "mm",
  "page": { "preset": "A4", "widthMm": 210, "heightMm": 297 },
  "grid": { "spacingMm": 5, "snap": false, "visible": true, "snapRotationDeg": null },
  "labelDesign": {
    "widthMm": 50,
    "heightMm": 30,
    "qrBlocks": [
      {
        "id": "uuid-aqui",
        "xMm": 5, "yMm": 5,
        "sizeMm": 20,
        "rotationDeg": 0,
        "showText": true,
        "textPosition": "below",
        "textOffsetMm": 1,
        "fontSize": 8,
        "fontFamily": "Roboto Mono"
      }
    ]
  },
  "placements": [
    { "id": "uuid-aqui", "xMm": 10, "yMm": 10, "rotationDeg": 0 }
  ],
  "printHistory": {
    "records": [
      {
        "start": 1, "end": 500, "step": 1,
        "padWidth": 6, "prefix": "GGC", "suffix": "",
        "printedAt": "2025-03-07T14:32:00.000Z",
        "totalPrinted": 500,
        "printerName": "HP LaserJet M404"
      }
    ]
  }
}
```

---

## Notas de impresión

- Se usa `webContents.print()` de Electron — sin dependencias nativas.
- Se imprime **página por página** (una BrowserWindow oculta por página).
- Cada página vive en RAM solo mientras se imprime, luego se destruye.
- Máximo **5000 etiquetas** por trabajo (mínimo garantizado: 1500).
- Los QRs se generan en **SVG** para máxima calidad en cualquier escala.
- La posición se especifica en **mm exactos** con `@page { margin: 0 }`.
