import { ipcMain, app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, statSync } from 'fs'
import log from 'electron-log'
import { TemplateSchema, type Template } from '../../shared/schema'

const TEMPLATES_DIR = join(app.getPath('userData'), 'templates')

function ensureDir(): void {
  if (!existsSync(TEMPLATES_DIR)) mkdirSync(TEMPLATES_DIR, { recursive: true })
}

function sanitizeName(name: string): string {
  return name
    .normalize('NFD')                  // decompose accented chars (á → a + combining accent)
    .replace(/[\u0300-\u036f]/g, '')   // remove combining diacritical marks
    .replace(/[^a-zA-Z0-9_\- ]/g, '_')
}

function templatePath(name: string): string {
  return join(TEMPLATES_DIR, `${sanitizeName(name)}.json`)
}

export interface TemplateListItem {
  name: string
  modifiedAt: string
  lastPrint: string | null
}

export function registerTemplateHandlers(): void {
  ensureDir()

  ipcMain.handle('template:list', (): TemplateListItem[] => {
    ensureDir()
    try {
      const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'))
      return files.map(file => {
        const name = file.replace(/\.json$/, '')
        const filePath = join(TEMPLATES_DIR, file)
        const stat = statSync(filePath)
        let lastPrint: string | null = null
        try {
          const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
          if (raw?.printHistory?.records?.length > 0) {
            const rec = raw.printHistory.records[0]
            lastPrint = rec.printedAt ?? null
          }
        } catch { /* ignore */ }
        return { name, modifiedAt: stat.mtime.toISOString(), lastPrint }
      }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    } catch (err) {
      log.error('template:list error', err)
      return []
    }
  })

  ipcMain.handle('template:exists', (_, name: string): boolean => {
    return existsSync(templatePath(name))
  })

  ipcMain.handle('template:load', (_, name: string): { ok: true; data: Template } | { ok: false; error: string } => {
    try {
      const p = templatePath(name)
      if (!existsSync(p)) return { ok: false, error: `La plantilla "${name}" no existe o fue eliminada.` }
      const raw = JSON.parse(readFileSync(p, 'utf-8'))
      const parsed = TemplateSchema.safeParse(raw)
      if (!parsed.success) {
        log.error('template:load validation error', parsed.error)
        const first = parsed.error.errors[0]
        return { ok: false, error: `Archivo inválido: ${first ? `${first.path.join('.')}: ${first.message}` : parsed.error.message}` }
      }
      log.info(`Loaded template: ${name}`)
      return { ok: true, data: parsed.data }
    } catch (err) {
      log.error('template:load error', err)
      const msg = err instanceof SyntaxError
        ? 'El archivo está dañado o no es un JSON válido.'
        : 'No se pudo leer el archivo de la plantilla.'
      return { ok: false, error: msg }
    }
  })

  ipcMain.handle('template:save', (_, name: string, data: Template): { ok: boolean; error?: string } => {
    try {
      ensureDir()
      writeFileSync(templatePath(name), JSON.stringify(data, null, 2), 'utf-8')
      log.info(`Saved template: ${name}`)
      return { ok: true }
    } catch (err) {
      log.error('template:save error', err)
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('template:delete', (_, name: string): { ok: boolean } => {
    try {
      const p = templatePath(name)
      if (existsSync(p)) unlinkSync(p)
      return { ok: true }
    } catch (err) {
      log.error('template:delete error', err)
      return { ok: false }
    }
  })

  ipcMain.handle('template:rename', (_, oldName: string, newName: string): { ok: boolean; error?: string } => {
    try {
      const src = templatePath(oldName)
      const dst = templatePath(newName)
      if (!existsSync(src)) return { ok: false, error: `La plantilla "${oldName}" no existe o fue eliminada.` }
      if (existsSync(dst)) return { ok: false, error: `Ya existe una plantilla llamada "${newName}".` }
      renameSync(src, dst)
      return { ok: true }
    } catch (err) {
      log.error('template:rename error', err)
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('printer:list', async (event): Promise<{ name: string; isDefault: boolean }[]> => {
    try {
      const win = require('electron').BrowserWindow.fromWebContents(event.sender)
      if (!win) return []
      const printers = await win.webContents.getPrintersAsync()
      return printers.map((p: { name: string; isDefault: boolean }) => ({ name: p.name, isDefault: p.isDefault }))
    } catch (err) {
      log.error('printer:list error', err)
      return []
    }
  })
}
