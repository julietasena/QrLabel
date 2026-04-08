import QRCode from 'qrcode'

const dataUrlCache = new Map<string, string>()

function svgToDataUrl(svg: string): string {
  const b64 = typeof Buffer !== 'undefined'
    ? Buffer.from(svg).toString('base64')
    : btoa(unescape(encodeURIComponent(svg)))
  return `data:image/svg+xml;base64,${b64}`
}

export async function generateQrDataUrl(payload: string): Promise<string> {
  if (dataUrlCache.has(payload)) return dataUrlCache.get(payload)!
  const svg = await QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: '#000000', light: '#ffffff' }
  })
  const url = svgToDataUrl(svg)
  dataUrlCache.set(payload, url)
  return url
}

export function clearQrCache(): void {
  dataUrlCache.clear()
}
