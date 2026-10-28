'use client'
import { useContext, useEffect, useRef } from 'react'
import { ThemeLinks } from './themeLinks.js'
import { linkedNotes, noteExcerpt } from '../themesApi.js'
import '../themes.css'

const LINKED = 'is-theme-linked'

// A theme card: the title, how many notes it groups, and an excerpt of each live note it links to (React text only). While the
// pointer is over the card or it has keyboard focus, its source notes on the canvas get an outline (nothing else changes).
export default function Theme({ item }) {
  const byId = useContext(ThemeLinks)
  const box = useRef(null)
  const notes = linkedNotes(item, byId)
  const key = notes.map((n) => n.id).join(',')

  useEffect(() => {
    const host = box.current?.closest('.bd-item')
    const canvas = host?.parentElement
    if (!host || !canvas) return undefined
    const ids = key ? key.split(',') : []
    const mark = (on) => {
      for (const id of ids) canvas.querySelector(`.bd-item[data-id="${CSS.escape(id)}"]`)?.classList.toggle(LINKED, on)
    }
    const on = () => mark(true)
    const off = () => mark(false)
    host.addEventListener('pointerenter', on)
    host.addEventListener('pointerleave', off)
    host.addEventListener('focusin', on)
    host.addEventListener('focusout', off)
    return () => {
      ;['pointerenter', 'pointerleave', 'focusin', 'focusout'].forEach((t, i) => host.removeEventListener(t, i % 2 ? off : on))
      off()
    }
  }, [key])

  return (
    <div ref={box} className="bd-theme" role="group" aria-label={`Theme ${item.data.title}, ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}>
      <div className="bd-theme-head">
        <span className="bd-theme-title">{item.data.title}</span>
        <span className="bd-theme-count" aria-hidden="true">{notes.length}</span>
      </div>
      <ul className="bd-theme-notes">
        {notes.slice(0, 6).map((n) => <li key={n.id}>{noteExcerpt(n, 50)}</li>)}
        {notes.length > 6 && <li className="bd-theme-more">+{notes.length - 6} more</li>}
      </ul>
    </div>
  )
}
