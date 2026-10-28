'use client'
// Window-level keyboard, paste and drag-drop for the canvas. Ignored while the user is typing in a field.
import { useEffect, useRef } from 'react'

const TOOL_KEYS = { v: 'select', n: 'note', t: 'text', s: 'shape', c: 'connector', f: 'frame', i: 'image' }
const onControl = (el) => Boolean(el?.closest?.('button, a, [role="button"]')) // Space/Enter belong to a focused control
const typing = (el) => Boolean(el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))

// env: { ctl, actions, tool, pickTool(id), selection, setSelection, setSpace, cancelGesture, pointerWorld(),
//         throwing: { armed, atItem(id), disarm() }, voting: { open, can(id), toggle(id) } }
export function useShortcuts(env) {
  const E = useRef(env)
  E.current = env

  useEffect(() => {
    const onKeyDown = (e) => {
      const { ctl, actions, pickTool, setSpace } = E.current
      if (typing(e.target) || e.target.closest?.('[role="dialog"]')) return // fields and dialogs (settings, persona) own their keys
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      // Keys a focused control (button, link) uses for itself. Items, connectors and the canvas region are not controls.
      const own = onControl(e.target)
      if ((key === ' ' || key === 'Enter') && own) return
      if (key === ' ') { e.preventDefault(); setSpace(true); return }
      if (mod) {
        if (key === 'z') { e.preventDefault(); if (e.shiftKey) ctl.redo(); else ctl.undo() }
        else if (key === 'y') { e.preventDefault(); ctl.redo() }
        else if (key === 'd') { e.preventDefault(); actions.duplicateSelected() }
        else if (key === 'a') { e.preventDefault(); actions.selectAll() }
        return
      }
      if (e.altKey) return
      const { throwing, voting } = E.current
      const itemId = e.target.closest?.('.bd-item[data-id]')?.dataset.id
      if (throwing?.armed) { // an armed emoji: Esc puts it down, Enter on a focused note throws it
        if (key === 'Escape') { throwing.disarm(); return }
        if (key === 'Enter' && itemId && !own) { e.preventDefault(); throwing.atItem(itemId); return }
      }
      if (key === 'v' && !e.shiftKey && itemId && voting?.open && voting.can(itemId)) { e.preventDefault(); voting.toggle(itemId); return } // V is Select elsewhere, but on a note while voting it votes
      if (key === 'Escape') { E.current.cancelGesture(); E.current.setSelection(new Set()); pickTool('select'); return }
      if (own && (key === 'Delete' || key === 'Backspace' || key.startsWith('Arrow'))) return
      if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); actions.deleteSelected(); return }
      if (key === 'Enter' || key === 'F2') { if (actions.startEdit()) e.preventDefault(); return } // else the keypress would land in the new editor as a newline
      if (key === '[') { actions.reorder(-1); return }
      if (key === ']') { actions.reorder(1); return }
      if (key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        actions.nudge(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0)
        return
      }
      const tool = TOOL_KEYS[key]
      if (tool && !e.shiftKey) pickTool(tool)
    }
    const onKeyUp = (e) => { if (e.key === ' ') E.current.setSpace(false) }
    const onBlur = () => E.current.setSpace(false)

    const onPaste = (e) => {
      if (typing(e.target) || E.current.ctl.readOnly) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (!file) return
      e.preventDefault()
      E.current.actions.placeImage(file)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('paste', onPaste)
    }
  }, [])
}
