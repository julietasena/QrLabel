import QRCode from 'qrcode'
import type { LabelDesign, Placement, QrBlock } from '../../shared/schema'
import { MM_TO_PX_BASE as PX_PER_MM } from '../../shared/units'

function px(mm: number): string {
  return `${(mm * PX_PER_MM).toFixed(3)}px`
}

// ── Inline SVG — avoids nested data-URL restriction in Chromium ──────────────
async function getQrSvgInline(payload: string, sizeMm: number): Promise<string> {
  const raw = await QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: '#000000', light: '#ffffff' }
  })
  // Strip XML declaration, set explicit size so SVG scales to the element
  const cleaned = raw
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .trim()

  // Inject width/height that match the physical size
  const withSize = cleaned
    .replace(/<svg([^>]*)>/, (_, attrs) => {
      // Remove any existing width/height, add ours
      const noWH = attrs.replace(/\s*width="[^"]*"/g, '').replace(/\s*height="[^"]*"/g, '')
      return `<svg${noWH} width="${px(sizeMm)}" height="${px(sizeMm)}" style="display:block;">`
    })
  return withSize
}

function renderQrBlock(block: QrBlock, payload: string, svgInline: string): string {
  const rot = block.rotationDeg !== 0
    ? `transform:rotate(${block.rotationDeg}deg);transform-origin:0 0;`
    : ''

  let textHtml = ''
  if (block.showText) {
    const above = block.textPosition === 'above'
    const offset = px(block.textOffsetMm)
    const pos = above
      ? `bottom:calc(100% + ${offset});`
      : `top:calc(100% + ${offset});`
    // Center text over the QR block using CSS translate trick:
    // left:50% puts the text div's left edge at the QR block center,
    // then translateX(-50%) shifts it back half its own width → visually centered.
    // The placement's overflow:hidden clips any text extending beyond the label.
    const textLeft = block.wrapText
      ? `left:0; width:${px(block.sizeMm)};`
      : `left:50%; transform:translateX(-50%);`
    textHtml = `<div style="
      position:absolute;
      ${textLeft}
      ${pos}
      text-align:center;
      font-family:'${block.fontFamily}','Courier New',monospace;
      font-size:${block.fontSize}pt;
      line-height:1.2;
      white-space:${block.wrapText ? 'normal' : 'nowrap'};
      color:#000000;
    ">${payload.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`
  }

  return `
  <div style="
    position:absolute;
    left:${px(block.xMm)};
    top:${px(block.yMm)};
    width:${px(block.sizeMm)};
    height:${px(block.sizeMm)};
    ${rot}
  ">
    ${svgInline}
    ${textHtml}
  </div>`
}

function renderPlacement(
  pl: Placement,
  ld: LabelDesign,
  payload: string,
  svgMap: Map<string, string>
): string {
  const rot = pl.rotationDeg !== 0
    ? `transform:rotate(${pl.rotationDeg}deg);transform-origin:0 0;`
    : ''

  const blocks = ld.qrBlocks
    .map(b => renderQrBlock(b, payload, svgMap.get(`${payload}__${b.sizeMm}`)!))
    .join('\n')

  return `
  <div style="
    position:absolute;
    left:${px(pl.xMm)};
    top:${px(pl.yMm)};
    width:${px(ld.widthMm)};
    height:${px(ld.heightMm)};
    overflow:hidden;
    ${rot}
  ">${blocks}</div>`
}

export interface PageRenderOpts {
  pageWidthMm: number
  pageHeightMm: number
  labelDesign: LabelDesign
  placements: Placement[]
  payloads: string[]
}

export async function renderPageHtml(opts: PageRenderOpts): Promise<string> {
  const { pageWidthMm, pageHeightMm, labelDesign, placements, payloads } = opts

  // Build a set of (payload, sizeMm) pairs — one SVG per unique combination
  const needed = new Map<string, number>()
  for (const payload of new Set(payloads)) {
    for (const block of labelDesign.qrBlocks) {
      needed.set(`${payload}__${block.sizeMm}`, block.sizeMm)
    }
  }

  const svgMap = new Map<string, string>()
  await Promise.all(
    [...needed.entries()].map(async ([key, sizeMm]) => {
      const lastSep = key.lastIndexOf('__')
      const payload = key.substring(0, lastSep)
      svgMap.set(key, await getQrSvgInline(payload, sizeMm))
    })
  )

  const html = placements
    .slice(0, payloads.length)
    .map((pl, i) => renderPlacement(pl, labelDesign, payloads[i], svgMap))
    .join('\n')

  const pw = (pageWidthMm  * PX_PER_MM).toFixed(2)
  const ph = (pageHeightMm * PX_PER_MM).toFixed(2)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size:${pageWidthMm}mm ${pageHeightMm}mm; margin:0; }
  html,body {
    width:${pw}px; height:${ph}px;
    margin:0; padding:0;
    overflow:hidden;
    background:#ffffff;
  }
  * { box-sizing:border-box; }
</style>
</head>
<body>
${html}
</body>
</html>`
}
