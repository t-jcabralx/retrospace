'use client'
// An outline in each person's colour around the items they have selected, with a tiny name tag. In the world layer,
// above the items; click-through and aria-hidden.
import { useSyncExternalStore } from 'react'
import { personColor } from './personColor.js'
import { NO_PRESENCE } from './noPresence.js'

const EMPTY = []

export default function PeerSelections({ presence, byId }) {
  const store = presence ?? NO_PRESENCE
  const list = useSyncExternalStore(store.subscribe, store.getSelections, () => EMPTY)
  if (!list.length) return null
  const taken = new Map() // item id -> people already tagged on it, so two tags never sit on top of each other
  const out = []
  for (const s of list) {
    for (const id of s.ids) {
      const item = byId.get(id)
      if (!item || item.kind === 'connector') continue
      const slot = taken.get(id) ?? 0
      taken.set(id, slot + 1)
      out.push(
        <div
          key={`${s.id}:${id}`}
          className="bd-peersel"
          aria-hidden="true"
          style={{ width: item.w, height: item.h, transform: `translate(${item.x}px, ${item.y}px)${item.rot ? ` rotate(${item.rot}deg)` : ''}`, '--bd-pc': personColor(s.avatar), '--bd-slot': slot }}
        >
          <span className="bd-peersel-tag">{s.name}</span>
        </div>,
      )
    }
  }
  return out
}
