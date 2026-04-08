import { useState, useEffect } from 'react'
import { generateQrDataUrl } from '../../../shared/qr'

/** Loads a QR code as an HTMLImageElement for use in Konva. Returns null while loading. */
export function useQrImage(payload: string): HTMLImageElement | null {
  const [qrImg, setQrImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    let cancelled = false
    generateQrDataUrl(payload).then(url => {
      if (cancelled) return
      const img = new window.Image(); img.src = url
      img.onload = () => { if (!cancelled) setQrImg(img) }
    })
    return () => { cancelled = true }
  }, [payload])
  return qrImg
}
