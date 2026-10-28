'use client'
// The save state of ONE control in the settings panel: idle -> saving -> saved | error. `run(patch)` is the owner's
// patchBoard (-> { ok, error }). A control disables itself while `busy` and shows its own SaveNote, so no change can
// fail silently or be sent twice.
import { useCallback, useEffect, useRef, useState } from 'react'

const SAVED_MS = 2500

export function useSetting(run) {
  const [state, setState] = useState({ phase: 'idle', error: '' })
  const timer = useRef(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [])

  const save = useCallback(async (patch) => {
    clearTimeout(timer.current)
    const had = document.activeElement
    setState({ phase: 'saving', error: '' })
    const r = await run(patch)
    // A control that was disabled while saving drops keyboard focus to the page: give it back once it is enabled again.
    setTimeout(() => { if (had?.isConnected && document.activeElement === document.body) had.focus() }, 0)
    if (!alive.current) return r.ok
    if (r.ok) {
      setState({ phase: 'saved', error: '' })
      timer.current = setTimeout(() => setState({ phase: 'idle', error: '' }), SAVED_MS)
    } else {
      setState({ phase: 'error', error: r.error })
    }
    return r.ok
  }, [run])

  const fail = useCallback((error) => { clearTimeout(timer.current); setState({ phase: 'error', error }) }, [])
  const clear = useCallback(() => { clearTimeout(timer.current); setState({ phase: 'idle', error: '' }) }, [])
  return { ...state, busy: state.phase === 'saving', save, fail, clear }
}
