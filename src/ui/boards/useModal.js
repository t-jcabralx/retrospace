'use client'
// Modal behaviour for a dialog element: moves focus in, keeps Tab inside, closes on Escape, locks page scroll, makes
// the rest of the page inert and puts focus back where it was when the dialog goes away.
import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const visible = (el) => !el.hidden && el.getClientRects().length > 0

export const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(visible)

// The element marked data-autofocus, else the first control, else the dialog itself.
export function focusInitial(root) {
  const target = root.querySelector('[data-autofocus]') ?? focusables(root)[0] ?? root
  target.focus()
  if (target.select && target.tagName === 'INPUT') target.select()
}

// `inert`: a selector for what to make inert while the dialog is open (the dashboard page by default; the board screen
// passes its own top bar and canvas).
// `openerRef.current` is the element that opened the dialog (set by its click handler, because Safari does not focus a
// button on click and document.activeElement can then be the body). `onClose` may change on every render: the newest is used.
export function useModal(ref, onClose, openerRef, { inert = '.rs-page' } = {}) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    const opener = openerRef?.current ?? document.activeElement
    const pages = [...document.querySelectorAll(inert)]
    const prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    for (const p of pages) p.setAttribute('inert', '')
    focusInitial(root)

    function onKey(e) {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return // something inside (an inline confirm step) already used this Esc
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(root)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.style.overflow = prevOverflow
      for (const p of pages) p.removeAttribute('inert')
      // The opener may have been replaced while the dialog was open (a button that hides and shows again): take the current one.
      const back = opener instanceof HTMLElement && document.contains(opener) ? opener : openerRef?.current
      if (back instanceof HTMLElement && document.contains(back)) back.focus()
    }
  }, [ref, openerRef, inert])
}
