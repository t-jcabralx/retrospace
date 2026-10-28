'use client'
// Other people's pointers, drawn inside the transformed world layer so they pan and zoom with the board. `presence`
// is the client from usePresence (null when there is no live stream: nothing is drawn). Purely decorative for screen
// readers (aria-hidden); the people list in the top bar is the accessible view of who is here.
import { useSyncExternalStore } from 'react'
import { personColor } from './personColor.js'
import { NO_PRESENCE } from './noPresence.js'

const EMPTY = []

export default function Cursors({ presence }) {
  const store = presence ?? NO_PRESENCE
  const list = useSyncExternalStore(store.subscribe, store.getCursors, () => EMPTY)
  if (!list.length) return null
  return list.map((c) => (
    // The outer element moves (and eases between positions); the inner one only undoes the board's zoom, so a pointer
    // keeps its size and never lags behind while zooming.
    <div key={`${c.id}:${c.key}`} className="bd-cursor" aria-hidden="true" style={{ transform: `translate(${c.x}px, ${c.y}px)`, '--bd-pc': personColor(c.avatar) }}>
      <div className="bd-cursor-in">
        <svg className="bd-cursor-arrow" width="18" height="22" viewBox="0 0 18 22" focusable="false">
          <path d="M2 2V18.5L6.6 14.2L9.9 21L13.2 19.5L9.9 12.8L16 12.6Z" />
        </svg>
        <span className="bd-cursor-name">{c.name}</span>
      </div>
    </div>
  ))
}
