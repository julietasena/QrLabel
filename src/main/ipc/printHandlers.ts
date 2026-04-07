import { ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import type { PrintJobConfig, PrintProgress } from '../../shared/schema'
import { renderPageHtml } from '../print/pageRenderer'
import { formatPayload } from '../../shared/numberFormat'
import { MM_TO_PX_BASE as PX_PER_MM } from '../../shared/units'

type PrintStatus = 'idle' | 'printing' | 'paused' | 'error' | 'done' | 'cancelled'

interface PrintState {
  status: PrintStatus
  currentPage: number
  totalPages: number
  currentLabel: string
  currentNumber: number
  resolveResume?: () => void
  cancelFlag: boolean
}

let state: PrintState = {
  status: 'idle', currentPage: 0, totalPages: 0,
  currentLabel: '', currentNumber: 0, cancelFlag: false
}

// Always send current full state to keep renderer in sync
function send(win: BrowserWindow, extra: Partial<PrintProgress> = {}) {
  if (win.isDestroyed()) return
  const p: PrintProgress = {
    currentPage:  state.currentPage,
    totalPages:   state.totalPages,
    currentLabel: state.currentLabel,
    currentNumber: state.currentNumber,
    status: state.status as PrintProgress['status'],
    ...extra
  }
  win.webContents.send('print:progress', p)
}

function waitResume(): Promise<boolean> {
  // If cancel/resume already fired before we entered, resolve immediately
  if (state.cancelFlag) return Promise.resolve(false)
  if (state.status !== 'paused') return Promise.resolve(true)
  return new Promise(resolve => {
    let done = false
    const finish = (val: boolean) => { if (!done) { done = true; resolve(val) } }
    const poll = setInterval(() => {
      if (state.cancelFlag) { clearInterval(poll); finish(false) }
      else if (state.status !== 'paused') { clearInterval(poll); finish(true) }
    }, 100)
    state.resolveResume = () => { clearInterval(poll); finish(!state.cancelFlag) }
  })
}

async function loadHtml(win: BrowserWindow, html: string): Promise<void> {
  const b64 = Buffer.from(html, 'utf-8').toString('base64')
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Load timeout (15s)')), 15000)
    win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve() })
    win.webContents.once('did-fail-load', (_, code, desc) => {
      clearTimeout(t); reject(new Error(`Load failed: ${desc} (${code})`))
    })
    win.loadURL(`data:text/html;charset=utf-8;base64,${b64}`)
  })
}

async function printOnePage(
  html: string, printerName: string,
  pageWidthMm: number, pageHeightMm: number
): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    width:  Math.ceil(pageWidthMm  * PX_PER_MM) + 100,
    height: Math.ceil(pageHeightMm * PX_PER_MM) + 100,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      javascript: true, images: true, backgroundThrottling: false
    }
  })
  try {
    await loadHtml(win, html)
    await new Promise(r => setTimeout(r, 600))
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          deviceName: printerName, silent: true, printBackground: true,
          margins: { marginType: 'none' }, scaleFactor: 100,
          pageSize: {
            width:  Math.round(pageWidthMm  * 1000),
            height: Math.round(pageHeightMm * 1000)
          }
        } as Electron.WebContentsPrintOptions,
        (success, errorType) => {
          log.info(`Print result: success=${success} error="${errorType}"`)
          if (success) resolve()
          else reject(new Error(errorType || 'unknown driver error'))
        }
      )
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export function registerPrintHandlers(mainWin: BrowserWindow): void {

  ipcMain.handle('print:start', async (_, config: PrintJobConfig) => {
    if (state.status === 'printing' || state.status === 'paused')
      return { ok: false, error: 'Ya hay un trabajo en curso' }

    const { labelDesign, placements, page, printConfig, printerName, start, end } = config
    const { padWidth, prefix, suffix, step, numberingMode } = printConfig

    if (!placements.length)       return { ok: false, error: 'Sin placements en la hoja' }
    if (!labelDesign.qrBlocks.length) return { ok: false, error: 'La etiqueta no tiene QR blocks' }

    const numbers: number[] = []
    for (let n = start; n <= end; n += step) numbers.push(n)

    const totalPages = numberingMode === 'offset'
      ? numbers.length
      : Math.ceil(numbers.length / placements.length)
    state = {
      status: 'printing', currentPage: 0, totalPages,
      currentLabel: '', currentNumber: 0, cancelFlag: false
    }

    log.info(`=== PRINT START: ${numbers.length} numbers, ${totalPages} pages, mode="${numberingMode}", printer="${printerName}" ===`)

    ;(async () => {
      try {
        for (let pi = 0; pi < totalPages; pi++) {
          if (state.cancelFlag) break

          if (state.status === 'paused') {
            const cont = await waitResume()
            if (!cont) break
            state.status = 'printing'
            send(mainWin)
          }

          state.currentPage = pi + 1
          let baseNumber: number
          let payloads: string[]
          let pagePlacements: typeof placements

          if (numberingMode === 'offset') {
            baseNumber = numbers[pi]
            payloads = placements.map(p => formatPayload(baseNumber + (p.numberOffset ?? 0), { padWidth, prefix, suffix }))
            pagePlacements = placements
          } else {
            const slice = numbers.slice(pi * placements.length, (pi + 1) * placements.length)
            payloads = slice.map(n => formatPayload(n, { padWidth, prefix, suffix }))
            pagePlacements = placements.slice(0, slice.length)
            baseNumber = slice[0]
          }
          state.currentLabel  = payloads[0]
          state.currentNumber = baseNumber

          log.info(`Page ${state.currentPage}/${totalPages}: ${payloads[0]} → ${payloads[payloads.length-1]}`)
          send(mainWin)

          let lastErr: Error | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const html = await renderPageHtml({
                pageWidthMm: page.widthMm, pageHeightMm: page.heightMm,
                labelDesign, placements: pagePlacements, payloads
              })
              await printOnePage(html, printerName, page.widthMm, page.heightMm)
              lastErr = null
              log.info(`  Page ${state.currentPage} OK`)
              break
            } catch (err) {
              lastErr = err as Error
              log.warn(`  Attempt ${attempt + 1} failed: ${lastErr.message}`)
              if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
            }
          }

          if (lastErr) {
            state.status = 'paused'
            send(mainWin, { status: 'error', errorMessage: lastErr.message })
            const cont = await waitResume()
            if (!cont) break
            state.status = 'printing'
            send(mainWin)
            pi--
          }
        }

        const final: PrintProgress['status'] = state.cancelFlag ? 'cancelled' : 'done'
        state.status = final === 'done' ? 'done' : 'cancelled'
        log.info(`=== PRINT ${final.toUpperCase()} ===`)
        send(mainWin)
      } catch (err) {
        log.error('Print crashed:', err)
        state.status = 'error'
        send(mainWin, { status: 'error', errorMessage: String(err) })
      }
    })()

    return { ok: true }
  })

  // ── pause: sets state AND notifies renderer immediately ──────────────────
  ipcMain.handle('print:pause', () => {
    if (state.status === 'printing') {
      state.status = 'paused'
      log.info('Paused')
      send(mainWin)   // ← this was missing — renderer now gets 'paused' status
    }
    return { ok: true }
  })

  // ── resume: resolves the wait and notifies renderer ──────────────────────
  ipcMain.handle('print:resume', () => {
    if (state.status === 'paused') {
      state.resolveResume?.()
      state.resolveResume = undefined
      log.info('Resumed')
      // The loop will update status to 'printing' and call send() itself
    }
    return { ok: true }
  })

  ipcMain.handle('print:cancel', () => {
    state.cancelFlag = true
    state.status = 'cancelled'
    state.resolveResume?.()
    state.resolveResume = undefined
    log.info('Cancelled')
    send(mainWin)
    return { ok: true }
  })
}
