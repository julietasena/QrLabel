import React, { useState, useEffect, useRef } from 'react'
import { TemplateListPage } from './pages/TemplateListPage'
import { EditorPage } from './pages/EditorPage'
import { useTemplateStore } from './store/templateStore'

type View = 'list' | 'editor'

export default function App() {
  const [view, setView] = useState<View>('list')
  const focusResetRef = useRef<HTMLInputElement>(null)
  // Debounce ref for focusin-triggered restores. During Transformer scaling, Konva
  // repeatedly refocuses its Stage div, which would fire multiple concurrent restoreKeyboard
  // calls whose focus()/blur() cycles interleave and corrupt TSF state. The debounce
  // collapses all rapid canvas-focus events into a single restoration 80ms after the last one.
  const pendingCanvasRestoreRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ============================================================
  // WINDOWS TSF/IME FIX — DO NOT MODIFY THIS BLOCK
  // ============================================================
  // Problem: after interacting with the Konva canvas and navigating
  // between the editor and the list view, text inputs stop accepting
  // typed characters (Delete works but letters/numbers don't).
  //
  // Root cause (Windows-specific, Electron + Chromium):
  //   A) When a focused DOM element is removed (Konva canvas unmounts),
  //      Windows stops routing keyboard events to the webContents at the
  //      OS level. JS element.focus() cannot recover this — only
  //      mainWindow.webContents.focus() from the main process can.
  //   B) Konva 9.x explicitly calls container.focus() on its Stage div
  //      (tabIndex=-1) inside its own mousedown handler (bubble phase).
  //      This corrupts Chromium's TSF/IME pipeline, breaking character
  //      input even when the webContents has keyboard routing.
  //
  // Solution — three cooperating mechanisms:
  //
  //   1. restoreKeyboard(): called on view transitions (editor mount/unmount).
  //      Sequence: await focusWindow() IPC → 32ms pause (Chromium processes
  //      the webContents focus notification asynchronously, the IPC promise
  //      resolves before that completes) → focus/blur on a hidden editable
  //      input (registers a fresh TSF text-input context, clearing the stale
  //      Konva association).
  //      DO NOT: remove the await, remove the 32ms pause, make the input
  //      readOnly (Chromium skips TSF registration for non-editable elements),
  //      or add a concurrency guard (it causes the restoration to be silently
  //      skipped during rapid navigation, breaking the fix after 2-3 cycles).
  //
  //   2. mousedown capture + preventDefault: prevents the browser from
  //      auto-focusing the <canvas> on click (standard click-to-focus).
  //
  //   3. focusin capture on canvas/Stage div: catches Konva's explicit
  //      container.focus() call (which runs after our mousedown capture so
  //      preventDefault doesn't stop it) and immediately blurs the element,
  //      then calls restoreKeyboard() to repair any TSF state already dirtied.
  //
  // This combination was validated after multiple failed approaches.
  // Tested: infinite lista↔editor cycles, create/search/rename templates,
  // properties panel inputs, all confirmed working.
  // ============================================================

  const restoreKeyboard = (delay = 0): ReturnType<typeof setTimeout> => {
    return setTimeout(async () => {
      const inputFocused = () => {
        const a = document.activeElement as HTMLElement | null
        return !!a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && a !== focusResetRef.current
      }
      if (inputFocused()) return  // teclado ya funciona — no robar foco
      await window.electronAPI.focusWindow()
      await new Promise<void>(r => setTimeout(r, 32))  // let browser thread process focus
      if (inputFocused()) return  // usuario focuseó un input durante el await
      focusResetRef.current?.focus()
      focusResetRef.current?.blur()
    }, delay)
  }

  const prevView = useRef<View | null>(null)
  useEffect(() => {
    if (prevView.current === null) { prevView.current = view; return }
    const prev = prevView.current
    prevView.current = view
    if (prev !== 'editor' && view !== 'editor') return
    const delay = view === 'editor' ? 100 : 50  // extra time for Konva to finish mounting
    const timer = restoreKeyboard(delay)
    return () => clearTimeout(timer)
  }, [view])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName !== 'CANVAS') return
      e.preventDefault()
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (el === focusResetRef.current) return
      const isCanvas = el.tagName === 'CANVAS'
      const isStage = el.tagName === 'DIV'
        && el.getAttribute('tabindex') === '-1'
        && el.querySelector(':scope > canvas') !== null
      if (isCanvas || isStage) {
        el.blur()
        // Debounce: during Transformer scaling Konva repeatedly refocuses its Stage
        // div. Multiple concurrent restoreKeyboard calls would interleave focus()/blur()
        // and corrupt TSF. Collapse all rapid canvas-focus events into one restore.
        if (pendingCanvasRestoreRef.current !== null) clearTimeout(pendingCanvasRestoreRef.current)
        pendingCanvasRestoreRef.current = setTimeout(() => {
          pendingCanvasRestoreRef.current = null
          restoreKeyboard(0)
        }, 80)
      }
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
    }
  }, [])
  // ============================================================
  // END WINDOWS TSF/IME FIX
  // ============================================================

  // confirm() dialogs: the native dialog layer intercepts keyboard input; IME breaks on close.
  // Wrapping here covers all confirm() call sites without touching each one individually.
  useEffect(() => {
    const orig = window.confirm.bind(window)
    window.confirm = (msg?: string): boolean => {
      const result = orig(msg)
      restoreKeyboard(50)
      return result
    }
    return () => { window.confirm = orig }
  }, [])

  // Window regains OS focus (alt-tab, print windows closing, etc.).
  // Guard: if a text input already has focus the keyboard is working — skip restoration.
  useEffect(() => {
    const onWindowFocus = () => {
      const active = document.activeElement as HTMLElement | null
      if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return
      restoreKeyboard(0)
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [])

  // Intercept OS close (Alt+F4, × button) — ask user if there are unsaved changes.
  useEffect(() => {
    const remove = window.electronAPI.onCloseRequest(() => {
      const { isDirty } = useTemplateStore.getState()
      if (!isDirty || confirm('Hay cambios sin guardar. ¿Cerrar de todas formas?')) {
        window.electronAPI.confirmClose()
      }
    })
    return remove
  }, [])

  return (
    <>
      {/* Hidden editable input used to reset Chromium's TSF/IME context. Must NOT be
          readOnly — Chromium skips TSF registration for non-editable elements. */}
      <input ref={focusResetRef} tabIndex={-1} aria-hidden="true"
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, opacity: 0 }} />
      {view === 'list'
        ? <TemplateListPage onOpen={() => setView('editor')} />
        : <EditorPage onBack={() => setView('list')} />}
    </>
  )
}
