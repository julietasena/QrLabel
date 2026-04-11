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
  win.webContents.send('print:progress', {
    currentPage:     state.currentPage,
    totalPages:      state.totalPages,
    currentLabel:    state.currentLabel,
    currentNumber:   state.currentNumber,
    confirmedPages:  state.confirmedPages,
    confirmedLabels: state.confirmedLabels,
    status: state.status as PrintProgress['status'],
    ...extra
  } satisfies PrintProgress)
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
    const t = setTimeout(() => reject(new Error('Load timeout (15s)')), 15_000)
    win.webContents.once('did-finish-load', () => { clearTimeout(t); resolve() })
    win.webContents.once('did-fail-load', (_, code, desc) => {
      clearTimeout(t); reject(new Error(`Load failed: ${desc} (${code})`))
    })
    win.loadURL(`data:text/html;charset=utf-8;base64,${b64}`)
  })
}

// ── Windows print queue monitoring ────────────────────────────────────────────
//
// Core bottleneck: every PowerShell process spawn takes 1-3s (cold start).
// Old code: 2 separate PS calls per monitoring loop (getPrintJobs + getPrinterStatus).
// Fix: ONE combined PS script per query — halves PS overhead per loop iteration.
//
// Strategy:
//   - Take snapshot + check printer health in one PS call just before webContents.print()
//     (replaces the explicit post-loadHtml sleep; ~2s PS duration stabilizes the render)
//   - Phase 1: wait up to 8s for our specific job to appear
//   - Phase 2: poll until job leaves queue (success) or error detected
//   - Fast-completion: if job never observed AND printer healthy → success
//     (virtual printers / fast local printers process jobs before our first poll)
//   - waitForJobCompletion returns the final queue snapshot so the main loop can
//     reuse it for the next page (eliminates one PS call per page from page 2 onward)
//
// Performance note: on machines where Windows Defender scans PS processes, each
// PS call may take 3-5s. Combined queries bring worst-case from ~5s to ~2.5s per
// monitoring iteration. Snapshot reuse saves an additional ~2s per page.

interface PrintJob { id: number; status: string }
interface PrinterStatus { isError: boolean; message: string }
interface PrintState2 { jobs: PrintJob[]; printer: PrinterStatus }

const STATUS_ERRORS: Record<number, string> = {
  1: 'La impresora está en pausa',
  2: 'Error en la impresora',
  6: 'Sin papel en la impresora',
  7: 'Problema con el papel',
  8: 'Impresora desconectada (offline)',
  9: 'Impresora desconectada (offline)',
  11: 'Atasco de papel',
  12: 'La impresora requiere intervención del usuario',
}

function parsePrinterStatus(p: Record<string, unknown> | null | undefined): PrinterStatus {
  if (!p) return { isError: false, message: '' }
  const st = Number(p.PrinterStatus ?? 0)
  const workOffline = Boolean(p.WorkOffline ?? false)
  const ext = String(p.ExtendedPrinterStatus ?? '').toLowerCase()
  const printerState = String(p.PrinterState ?? '').toLowerCase()
  if (workOffline) return { isError: true, message: 'Impresora desconectada (offline)' }
  if (STATUS_ERRORS[st]) return { isError: true, message: STATUS_ERRORS[st] }
  if (ext.includes('paper') || ext.includes('jam') || ext.includes('error') || ext.includes('offline'))
    return { isError: true, message: `Estado impresora: ${ext}` }
  if (printerState.includes('paper') || printerState.includes('jam') || printerState.includes('error') || printerState.includes('offline'))
    return { isError: true, message: `Estado impresora: ${printerState}` }
  return { isError: false, message: '' }
}

// Single PowerShell process that queries both print jobs and printer status.
// ~2x faster than two separate calls (one cold-start instead of two).
function queryPrintState(printerName: string): Promise<PrintState2> {
  return new Promise(resolve => {
    const n = printerName.replace(/'/g, "''")
    const cmd =
      `powershell -NoProfile -NonInteractive -Command "` +
      `$o=@{j=@();p=$null};` +
      `try{$jj=Get-PrintJob -PrinterName '${n}' -EA Stop;if($jj){$o.j=@($jj|Select-Object Id,JobStatus,Status)}}catch{};` +
      `try{$pp=Get-Printer -Name '${n}' -EA Stop;$o.p=($pp|Select-Object PrinterStatus,WorkOffline,ExtendedPrinterStatus,PrinterState)}catch{};` +
      `$o|ConvertTo-Json -Compress -Depth 3"`
    exec(cmd, { timeout: 12_000 }, (err, stdout) => {
      const out = (stdout ?? '').trim()
      if (err || !out) { resolve({ jobs: [], printer: { isError: false, message: '' } }); return }
      try {
        const raw = JSON.parse(out)
        const jArr: unknown[] = Array.isArray(raw.j) ? raw.j : (raw.j ? [raw.j] : [])
        const jobs: PrintJob[] = jArr
          .filter(j => j && typeof j === 'object')
          .map(j => {
            const jj = j as Record<string, unknown>
            return {
              id: Number(jj.Id ?? 0),
              status: `${String(jj.JobStatus ?? '')} ${String(jj.Status ?? '')}`.trim()
            }
          })
        const printer = parsePrinterStatus(raw.p as Record<string, unknown> ?? null)
        resolve({ jobs, printer })
      } catch { resolve({ jobs: [], printer: { isError: false, message: '' } }) }
    })
  })
}

const ERROR_KEYWORDS: string[] = [
  'out of paper', 'outofpaper', 'paper out', 'paperout', 'sin papel',
  'paper problem', 'paperproblem', 'jammed', 'jam', 'atasco',
  'offline', 'desconectada', 'user intervention', 'intervention',
  'blocked', 'paused', 'pause', 'error',
]

function mapErrorKeyword(jobStatus: string): string | null {
  const s = jobStatus.toLowerCase()
  if (s.includes('out of paper') || s.includes('outofpaper') || s.includes('paper out') || s.includes('paperout') || s.includes('sin papel'))
    return 'Sin papel en la impresora'
  if (s.includes('jammed') || s.includes('jam') || s.includes('atasco')) return 'Atasco de papel'
  if (s.includes('offline') || s.includes('desconectada')) return 'Impresora desconectada (offline)'
  if (s.includes('user intervention') || s.includes('intervention')) return 'La impresora requiere intervención del usuario'
  if (s.includes('blocked')) return 'Trabajo bloqueado por la impresora'
  if (s.includes('paper problem') || s.includes('paperproblem')) return 'Problema con el papel'
  if (s.includes('paused') || s.includes('pause')) return 'La impresora está en pausa'
  if (s.includes('error')) return 'Error en la impresora'
  return null
}

function mapPrintErrorMessage(raw: string): string {
  const msg = (raw ?? '').toLowerCase()
  if (msg.includes('sin papel') || msg.includes('out of paper') || msg.includes('outofpaper') || msg.includes('paper out') || msg.includes('paperout'))
    return 'No hay papel en la impresora. Cargá papel y reanudá la impresión.'
  if (msg.includes('atasco') || msg.includes('jammed') || msg.includes('jam'))
    return 'Hay un atasco de papel. Liberá el atasco y reanudá la impresión.'
  if (msg.includes('offline') || msg.includes('desconectada'))
    return 'La impresora está desconectada (offline). Verificá conexión/estado y reanudá.'
  if (msg.includes('pausa') || msg.includes('paused'))
    return 'La impresora está en pausa. Quitá la pausa y reanudá la impresión.'
  if (msg.includes('paper problem') || msg.includes('paperproblem') || msg.includes('problema con el papel'))
    return 'La impresora reporta un problema con el papel. Revisá bandeja/alimentación y reanudá.'
  if (msg.includes('user intervention') || msg.includes('intervención del usuario'))
    return 'La impresora requiere intervención del usuario. Corregí el problema y reanudá.'
  if (msg.includes('blocked') || msg.includes('bloqueado'))
    return 'El trabajo quedó bloqueado por la impresora. Revisá la cola y reanudá.'
  if (msg.includes('tiempo de espera agotado') || msg.includes('timeout'))
    return 'La impresora no confirmó la impresión a tiempo. Revisá estado y reanudá.'
  if (msg.includes('cola de impresión') || msg.includes('monitoreo'))
    return 'No se pudo confirmar el estado de la cola de impresión. Revisá impresora/cola y reanudá.'
  return 'Se produjo un error de impresión. Revisá la impresora y reanudá.'
}

// Wait for the physically-printed job to leave the print queue.
// Returns the final queue snapshot (job ID set) so the next page can reuse it
// as its pre-snapshot, eliminating one PS call per page after the first.
//
// Phases:
//   Phase 1 (up to 8s): identify our job ID in the queue. No explicit sleep —
//     the PS call itself takes ~1-3s, providing natural throttling.
//   Phase 2: monitor until job leaves queue. 200ms explicit sleep + ~2s PS call
//     = ~2.2s per poll, which is responsive without hammering the system.
async function waitForJobCompletion(
  printerName: string,
  preSnapshot: Set<number>,
  timeoutMs = 90_000
): Promise<Set<number>> {
  const t0 = Date.now()
  const deadline = t0 + timeoutMs

  // ── Phase 1: find our job ID ───────────────────────────────────────────────
  let ourJobId: number | null = null
  const phase1Deadline = t0 + 8_000
  let lastState: PrintState2 = { jobs: [], printer: { isError: false, message: '' } }

  while (Date.now() < phase1Deadline) {
    try { lastState = await queryPrintState(printerName) }
    catch { throw new Error(mapPrintErrorMessage('No se pudo monitorear la cola de impresión')) }

    if (lastState.printer.isError)
      throw new Error(mapPrintErrorMessage(lastState.printer.message))

    const newJob = lastState.jobs.find(j => !preSnapshot.has(j.id))
    if (newJob) {
      ourJobId = newJob.id
      log.info(`  [+${Date.now() - t0}ms] Job ${ourJobId} in queue`)
      break
    }
    // No sleep — natural throttle from PS cold start (~1-3s per call)
  }

  if (ourJobId === null) {
    // Job was never observed in queue after Phase 1.
    // Fast-completion: virtual/local printers can process jobs before our first poll.
    // verifyNoLatePrinterError: 1 check is sufficient (3 was wasteful — each PS call ~2s)
    const verifyState = await queryPrintState(printerName)
    if (verifyState.printer.isError)
      throw new Error(mapPrintErrorMessage(verifyState.printer.message))
    log.info(`  [+${Date.now() - t0}ms] Job not observed — printer healthy, fast completion assumed`)
    return new Set(verifyState.jobs.map(j => j.id))
  }

  // ── Phase 2: wait for job to leave queue ──────────────────────────────────
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200))  // brief pause; PS call adds ~2s naturally

    let ps: PrintState2
    try { ps = await queryPrintState(printerName) }
    catch { throw new Error(mapPrintErrorMessage('Se perdió el monitoreo de cola durante la impresión')) }

    const ourJob = ps.jobs.find(j => j.id === ourJobId)
    if (!ourJob) {
      // Job left queue — do one quick late-error check before confirming success
      const verifyState = await queryPrintState(printerName)
      if (verifyState.printer.isError)
        throw new Error(mapPrintErrorMessage(verifyState.printer.message))
      log.info(`  [+${Date.now() - t0}ms] Job ${ourJobId} left queue — confirmed`)
      return new Set(verifyState.jobs.map(j => j.id))
    }

    // Check job-level error flags
    const jobErrMsg = mapErrorKeyword(ourJob.status)
    if (jobErrMsg) throw new Error(mapPrintErrorMessage(jobErrMsg))

    // Check hardware-level printer status
    if (ps.printer.isError)
      throw new Error(mapPrintErrorMessage(ps.printer.message))
  }

  throw new Error(mapPrintErrorMessage('Tiempo de espera agotado: la impresora no confirmó la impresión en 90 segundos'))
}

// ── Single-page print ─────────────────────────────────────────────────────────
//
// Flow:
//   1. Load HTML in hidden BrowserWindow
//   2. Query print state (snapshot + printer health) — this call takes ~2s which
//      also acts as render stabilization time, replacing the old explicit sleep
//   3. If printer already in error → throw before wasting time submitting
//   4. Submit to spooler via webContents.print()
//   5. Notify caller (onSpooled) — renderer shows 'spooled' immediately
//   6. Destroy window (no longer needed)
//   7. Monitor queue until physical confirmation
//   8. Return final snapshot for reuse by next page

async function printOnePage(
  html: string,
  printerName: string,
  pageWidthMm: number,
  pageHeightMm: number,
  onSpooled: () => void
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

    // Query print state AFTER load: the ~2s PS duration stabilizes render and
    // checks printer health before submitting. No snapshot needed — we no longer
    // wait for the job to leave the queue.
    const ps = await queryPrintState(printerName)
    if (ps.printer.isError) throw new Error(mapPrintErrorMessage(ps.printer.message))

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
          log.info(`  Spooler: success=${success} error="${errorType}"`)
          if (success) resolve()
          else reject(new Error(mapPrintErrorMessage(errorType || 'unknown driver error')))
        }
      )
    })

    onSpooled()
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
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

    log.info(`=== PRINT START: ${numbers.length} labels, ${totalPages} pages, printer="${printerName}" ===`)
    send(mainWin)

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

          // Compute page payload
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
          state.status = 'printing'
          send(mainWin)  // renderer shows new page number immediately

          log.info(`Page ${state.currentPage}/${totalPages}: ${payloads[0]} → ${payloads[payloads.length - 1]}`)

          // Render HTML (fast — pure JS string generation, no async I/O)
          const html = await renderPageHtml({
            pageWidthMm: page.widthMm, pageHeightMm: page.heightMm,
            labelDesign, placements: pagePlacements, payloads
          })

          // ── Spool page (retry on error with user intervention) ──────────────
          let pageOk = false
          while (!pageOk && !state.cancelFlag) {
            try {
              await printOnePage(
                html, printerName, page.widthMm, page.heightMm,
                () => { state.status = 'spooled'; send(mainWin) }
              )

              state.confirmedPages  += 1
              state.confirmedLabels += payloads.length
              state.status = 'printing'
              send(mainWin)
              log.info(`  Page ${state.currentPage} sent (${state.confirmedPages}/${totalPages})`)
              pageOk = true

            } catch (err) {
              if (state.cancelFlag) break
              const msg = err instanceof Error ? err.message : String(err)
              log.warn(`  Page ${state.currentPage} error: ${msg}`)
              state.status = 'paused'
              send(mainWin, { status: 'error', errorMessage: mapPrintErrorMessage(msg) })

              const cont = await waitResume()
              if (!cont) break

              state.status = 'printing'
              send(mainWin)
            }
          }

          if (!pageOk) break
        }

        const final: PrintProgress['status'] = state.cancelFlag ? 'cancelled' : 'done'
        state.status = final === 'done' ? 'done' : 'cancelled'
        log.info(`=== PRINT ${final.toUpperCase()} ===`)
        send(mainWin)
      } catch (err) {
        log.error('Print crashed:', err)
        state.status = 'error'
        const raw = err instanceof Error ? err.message : String(err)
        send(mainWin, { status: 'error', errorMessage: mapPrintErrorMessage(raw) })
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
