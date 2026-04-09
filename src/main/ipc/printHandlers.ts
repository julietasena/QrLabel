import { exec } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import log from 'electron-log'
import type { PrintJobConfig, PrintProgress } from '../../shared/schema'
import { renderPageHtml } from '../print/pageRenderer'
import { formatPayload, computePageCount } from '../../shared/numberFormat'
import { MM_TO_PX_BASE as PX_PER_MM } from '../../shared/units'

type PrintStatus = 'idle' | 'printing' | 'spooled' | 'paused' | 'error' | 'done' | 'cancelled'

interface PrintState {
  status: PrintStatus
  currentPage: number
  totalPages: number
  currentLabel: string
  currentNumber: number
  confirmedPages: number
  confirmedLabels: number
  resolveResume?: () => void
  cancelFlag: boolean
}

let state: PrintState = {
  status: 'idle', currentPage: 0, totalPages: 0,
  currentLabel: '', currentNumber: 0, confirmedPages: 0, confirmedLabels: 0, cancelFlag: false
}

function send(win: BrowserWindow, extra: Partial<PrintProgress> = {}) {
  if (win.isDestroyed()) return
  const p: PrintProgress = {
    currentPage:   state.currentPage,
    totalPages:    state.totalPages,
    currentLabel:  state.currentLabel,
    currentNumber: state.currentNumber,
    confirmedPages: state.confirmedPages,
    confirmedLabels: state.confirmedLabels,
    status: state.status as PrintProgress['status'],
    ...extra
  }
  win.webContents.send('print:progress', p)
}

function waitResume(): Promise<boolean> {
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

// ── Windows print queue monitoring ────────────────────────────────────────────
//
// Strategy: track the specific job ID submitted by webContents.print().
//
// The Windows Print Spooler calls the print callback with success=true as soon
// as it accepts the job — NOT when paper exits the printer. On hardware errors
// (no paper, offline, jam) the spooler may accept the call but discard the job
// before it appears in the queue. "Empty queue" alone is therefore ambiguous.
//
// Fix:
//   Phase 1 — snapshot queue IDs BEFORE submit, then wait for a NEW job to
//              appear (up to 10s). If none appears, check printer hardware status
//              for a descriptive error.
//   Phase 2 — monitor THAT specific job ID until it leaves the queue (success)
//              or shows an error flag / the printer enters an error state.

interface PrintJob {
  id: number
  status: string
}

interface PrinterStatus {
  isError: boolean
  message: string
}

function getPrintJobs(printerName: string): Promise<PrintJob[]> {
  return new Promise(resolve => {
    const safeName = printerName.replace(/'/g, "''")
    const cmd =
      `powershell -NoProfile -NonInteractive -Command "` +
      `try { $j = Get-PrintJob -PrinterName '${safeName}' -ErrorAction Stop; ` +
      `if ($j) { $j | Select-Object Id,JobStatus | ConvertTo-Json -Compress } ` +
      `else { '[]' } } catch { '[]' }"`
    exec(cmd, { timeout: 8000 }, (err, stdout) => {
      const out = (stdout ?? '').trim()
      if (err || !out || out === '[]') { resolve([]); return }
      try {
        const raw = JSON.parse(out)
        const arr = Array.isArray(raw) ? raw : [raw]
        resolve(arr.map(j => ({ id: Number(j.Id ?? 0), status: String(j.JobStatus ?? '') })))
      } catch { resolve([]) }
    })
  })
}

function getPrinterStatus(printerName: string): Promise<PrinterStatus> {
  return new Promise(resolve => {
    const safeName = printerName.replace(/'/g, "''")
    const cmd =
      `powershell -NoProfile -NonInteractive -Command "` +
      `try { $p = Get-Printer -Name '${safeName}' -ErrorAction Stop; ` +
      `$p | Select-Object PrinterStatus | ConvertTo-Json -Compress } ` +
      `catch { '{}' }"`
    exec(cmd, { timeout: 8000 }, (err, stdout) => {
      const out = (stdout ?? '').trim()
      if (err || !out || out === '{}') { resolve({ isError: false, message: '' }); return }
      try {
        const p = JSON.parse(out)
        const st = Number(p.PrinterStatus ?? 0)
        // WMI PrinterStatus: 3=Idle, 4=Printing, 5=WarmingUp — all others indicate a problem
        const STATUS_ERRORS: Record<number, string> = {
          1:  'La impresora está en pausa',
          2:  'Error en la impresora',
          6:  'Sin papel en la impresora',
          7:  'Problema con el papel',
          8:  'Impresora desconectada (offline)',
          9:  'Impresora desconectada (offline)',
          11: 'Atasco de papel',
          12: 'La impresora requiere intervención del usuario',
        }
        if (STATUS_ERRORS[st]) resolve({ isError: true, message: STATUS_ERRORS[st] })
        else resolve({ isError: false, message: '' })
      } catch { resolve({ isError: false, message: '' }) }
    })
  })
}

async function getQueueSnapshot(printerName: string): Promise<Set<number>> {
  try {
    const jobs = await getPrintJobs(printerName)
    return new Set(jobs.map(j => j.id))
  } catch {
    return new Set()
  }
}

const ERROR_KEYWORDS: Record<string, string> = {
  'out of paper':      'Sin papel en la impresora',
  'paper out':         'Sin papel en la impresora',
  'paper problem':     'Problema con el papel',
  'jammed':            'Atasco de papel',
  'jam':               'Atasco de papel',
  'offline':           'Impresora desconectada (offline)',
  'user intervention': 'La impresora requiere intervención del usuario',
  'blocked':           'Trabajo bloqueado por la impresora',
  'error':             'Error en la impresora',
}

async function verifyNoLatePrinterError(printerName: string, checks = 3, intervalMs = 350): Promise<void> {
  // Some drivers remove the job from queue before exposing the final hardware error.
  // Do a short post-disappearance health window before confirming success.
  for (let i = 0; i < checks; i++) {
    const printerSt = await getPrinterStatus(printerName)
    if (printerSt.isError) throw new Error(printerSt.message)
    if (i < checks - 1) await new Promise(r => setTimeout(r, intervalMs))
  }
}

async function waitForJobCompletion(
  printerName: string,
  preSnapshot: Set<number>,   // job IDs in the queue BEFORE webContents.print() was called
  timeoutMs = 120_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  // ── Phase 1: wait for our specific job to appear in the queue ─────────────
  // If the printer has an error (no paper, offline…), the spooler may accept
  // the submit call but discard the job immediately, so it never appears.
  // We poll for up to 10 s looking for a job ID that wasn't there before.
  let ourJobId: number | null = null
  const phase1Deadline = Date.now() + 10_000
  while (Date.now() < phase1Deadline) {
    await new Promise(r => setTimeout(r, 600))
    let jobs: PrintJob[]
    try { jobs = await getPrintJobs(printerName) }
    catch { break }  // PowerShell unavailable — skip monitoring

    const newJob = jobs.find(j => !preSnapshot.has(j.id))
    if (newJob) {
      ourJobId = newJob.id
      log.info(`  Job ID ${ourJobId} detected in queue`)
      break
    }
  }

  if (ourJobId === null) {
    // No job appeared — either the printer discarded it immediately (error)
    // or it completed so fast it was already gone before our first poll
    // (virtual printers, fast local printers).
    await verifyNoLatePrinterError(printerName)
    log.info('  No job appeared in queue — assuming fast completion or virtual printer')
    return
  }

  // ── Phase 2: monitor our job until it leaves the queue ────────────────────
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500))
    let jobs: PrintJob[]
    try { jobs = await getPrintJobs(printerName) }
    catch {
      log.warn('waitForJobCompletion: PowerShell query failed, skipping job monitoring')
      return
    }

    const ourJob = jobs.find(j => j.id === ourJobId)
    if (!ourJob) {
      await verifyNoLatePrinterError(printerName)
      log.info(`  Job ID ${ourJobId} left the queue — print confirmed`)
      return  // job completed successfully
    }

    // Check job-level error flags
    const jobSt = ourJob.status.toLowerCase()
    for (const [keyword, message] of Object.entries(ERROR_KEYWORDS)) {
      if (jobSt.includes(keyword)) throw new Error(message)
    }

    // Also check hardware-level printer status (catches errors not reflected in job status)
    const printerSt = await getPrinterStatus(printerName)
    if (printerSt.isError) throw new Error(printerSt.message)
  }

  throw new Error('Tiempo de espera agotado: la impresora no confirmó la impresión en 2 minutos')
}

// ── Single-page print ─────────────────────────────────────────────────────────

async function printOnePage(
  html: string,
  printerName: string,
  pageWidthMm: number,
  pageHeightMm: number,
  onSpooled?: () => void
): Promise<void> {
  // Snapshot queue BEFORE submitting so Phase 1 can identify our new job
  const preSnapshot = await getQueueSnapshot(printerName)

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

    // Submit to Windows Print Spooler
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
          log.info(`Spooler result: success=${success} error="${errorType}"`)
          if (success) resolve()
          else reject(new Error(errorType || 'unknown driver error'))
        }
      )
    })

    onSpooled?.()
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }

  // Wait for physical completion — runs OUTSIDE try/finally (window already destroyed)
  log.info(`  Monitoring job on "${printerName}"...`)
  await waitForJobCompletion(printerName, preSnapshot)
}

export function registerPrintHandlers(mainWin: BrowserWindow): void {

  ipcMain.handle('print:start', async (_, config: PrintJobConfig) => {
    if (state.status === 'printing' || state.status === 'paused' || state.status === 'spooled')
      return { ok: false, error: 'Ya hay un trabajo en curso' }

    const { labelDesign, placements, page, printConfig, printerName, start, end } = config
    const { padWidth, prefix, suffix, step, numberingMode } = printConfig

    if (!placements.length)           return { ok: false, error: 'Sin placements en la hoja' }
    if (!labelDesign.qrBlocks.length) return { ok: false, error: 'La etiqueta no tiene QR blocks' }

    const numbers: number[] = []
    for (let n = start; n <= end; n += step) numbers.push(n)

    const totalPages = computePageCount(numbers.length, placements.length, numberingMode)
    state = {
      status: 'printing', currentPage: 0, totalPages,
      currentLabel: '', currentNumber: 0, confirmedPages: 0, confirmedLabels: 0, cancelFlag: false
    }

    log.info(`=== PRINT START: ${numbers.length} numbers, ${totalPages} pages, mode="${numberingMode}", printer="${printerName}" ===`)
    send(mainWin, { status: 'printing', stage: 'starting' })

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
          state.status = 'printing'
          send(mainWin)

          let lastErr: Error | null = null
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const html = await renderPageHtml({
                pageWidthMm: page.widthMm, pageHeightMm: page.heightMm,
                labelDesign, placements: pagePlacements, payloads
              })
              await printOnePage(html, printerName, page.widthMm, page.heightMm, () => {
                state.status = 'spooled'
                send(mainWin, { status: 'spooled', stage: 'waiting_printer_ack' })
              })
              state.confirmedPages += 1
              state.confirmedLabels += payloads.length
              send(mainWin, { status: 'printing', stage: 'confirmed' })
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
            pi--  // retry same page
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

  ipcMain.handle('print:pause', () => {
    if (state.status === 'printing' || state.status === 'spooled') {
      state.status = 'paused'
      log.info('Paused')
      send(mainWin)
    }
    return { ok: true }
  })

  ipcMain.handle('print:resume', () => {
    if (state.status === 'paused') {
      state.resolveResume?.()
      state.resolveResume = undefined
      log.info('Resumed')
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
