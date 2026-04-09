import { app, BrowserWindow, shell, Menu, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import log from 'electron-log'
import { registerTemplateHandlers } from './ipc/templateHandlers'
import { registerPrintHandlers } from './ipc/printHandlers'

log.initialize()
log.info('QRLabel starting')

export let mainWindow: BrowserWindow | null = null
const isDev = !app.isPackaged

function buildMenu(win: BrowserWindow) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nueva plantilla',
          accelerator: 'CmdOrCtrl+N',
          click: () => win.webContents.send('menu:new')
        },
        {
          label: 'Abrir plantilla',
          accelerator: 'CmdOrCtrl+O',
          click: () => win.webContents.send('menu:open')
        },
        { type: 'separator' },
        {
          label: 'Guardar',
          accelerator: 'CmdOrCtrl+S',
          click: () => win.webContents.send('menu:save')
        },
        {
          label: 'Guardar como...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => win.webContents.send('menu:save-as')
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Deshacer', accelerator: 'CmdOrCtrl+Z', click: () => win.webContents.send('menu:undo') },
        { label: 'Rehacer', accelerator: 'CmdOrCtrl+Y', click: () => win.webContents.send('menu:redo') },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: () => win.webContents.send('menu:zoom-in') },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: () => win.webContents.send('menu:zoom-out') },
        { label: 'Zoom 100%', accelerator: 'CmdOrCtrl+0', click: () => win.webContents.send('menu:zoom-reset') },
        { type: 'separator' },
        ...(isDev ? [{ label: 'Herramientas de desarrollo', accelerator: 'F12', click: () => win.webContents.toggleDevTools() } as Electron.MenuItemConstructorOptions] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const devIconPath = join(app.getAppPath(), 'resources', 'icon.ico')
  const packagedIconPath = join(process.resourcesPath, 'icon.ico')
  const iconPath = existsSync(devIconPath)
    ? devIconPath
    : (existsSync(packagedIconPath) ? packagedIconPath : undefined)

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'QRLabel',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => { mainWindow!.show(); mainWindow!.focus() })
  mainWindow.on('close', e => {
    e.preventDefault()
    mainWindow!.webContents.send('window:close-request')
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })

  buildMenu(mainWindow)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerTemplateHandlers()
  registerPrintHandlers(mainWindow)
}

ipcMain.handle('window:set-title', (_, title: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(title)
})

ipcMain.handle('window:confirm-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.close()
  }
})

// Renderer calls this whenever Konva canvas mounts/unmounts or keyboard input
// stops responding. On Windows, removing a focused element from the DOM leaves
// the webContents with no keyboard routing at the OS level — element.focus() in
// JS cannot recover from that. Only mainWindow.webContents.focus() from the main
// process can restore OS-level keyboard input to the renderer.
ipcMain.handle('window:focus', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()             // ensure the BrowserWindow has OS-level focus
    mainWindow.webContents.focus() // restore keyboard input routing to webContents
  }
  return { ok: true }
})

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.qrlabel.app')
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
