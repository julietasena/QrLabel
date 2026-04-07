import { contextBridge, ipcRenderer } from 'electron'
import type { Template, PrintJobConfig, PrintProgress } from '../shared/schema'
import type { TemplateListItem } from '../main/ipc/templateHandlers'

const api = {
  listTemplates:    (): Promise<TemplateListItem[]> => ipcRenderer.invoke('template:list'),
  templateExists:   (name: string): Promise<boolean> => ipcRenderer.invoke('template:exists', name),
  loadTemplate:     (name: string): Promise<{ ok: true; data: Template } | { ok: false; error: string }> => ipcRenderer.invoke('template:load', name),
  saveTemplate:     (name: string, data: Template): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('template:save', name, data),
  deleteTemplate:   (name: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('template:delete', name),
  renameTemplate:   (oldName: string, newName: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('template:rename', oldName, newName),

  getPrinters: (): Promise<{ name: string; isDefault: boolean }[]> => ipcRenderer.invoke('printer:list'),

  startPrint:  (config: PrintJobConfig): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('print:start', config),
  pausePrint:  (): Promise<{ ok: boolean }> => ipcRenderer.invoke('print:pause'),
  resumePrint: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('print:resume'),
  cancelPrint: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('print:cancel'),

  onPrintProgress: (cb: (p: PrintProgress) => void): (() => void) => {
    const h = (_: Electron.IpcRendererEvent, p: PrintProgress) => cb(p)
    ipcRenderer.on('print:progress', h)
    return () => ipcRenderer.removeListener('print:progress', h)
  },

  setTitle: (title: string): Promise<void> => ipcRenderer.invoke('window:set-title', title),
  focusWindow: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('window:focus'),
  confirmClose: (): Promise<void> => ipcRenderer.invoke('window:confirm-close'),

  onCloseRequest: (cb: () => void): (() => void) => {
    const h = () => cb()
    ipcRenderer.on('window:close-request', h)
    return () => ipcRenderer.removeListener('window:close-request', h)
  },

  onMenuEvent: (cb: (ev: string) => void): (() => void) => {
    const evts = ['menu:new','menu:open','menu:save','menu:save-as','menu:undo','menu:redo','menu:zoom-in','menu:zoom-out','menu:zoom-reset']
    const hs = evts.map(ev => { const h = () => cb(ev); ipcRenderer.on(ev, h); return { ev, h } })
    return () => hs.forEach(({ ev, h }) => ipcRenderer.removeListener(ev, h))
  }
}

contextBridge.exposeInMainWorld('electronAPI', api)
export type ElectronAPI = typeof api
