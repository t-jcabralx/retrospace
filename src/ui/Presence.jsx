'use client'
// Top-bar "who is here": a compact stack of avatars (up to 5, then +N) that opens a list of everybody online, you
// first. A disclosure, not a menu: the button toggles the list, Esc or a click elsewhere closes it, and Tab moves
// on normally. Join / leave is announced politely, at most once every 3 seconds. Rendered only while the realtime
// stream is live and somebody else is here; with polling there is no presence and nothing appears.
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import Avatar from './Avatar.jsx'
import { NO_PRESENCE } from './noPresence.js'
import { personColor } from './personColor.js'
import { rosterChanges, announceText } from './presence.js'
import './collab.css'

const SHOWN = 5
const ANNOUNCE_GAP_MS = 3000
const EMPTY = []

// Collects joins and leaves and releases them as one sentence at most every ANNOUNCE_GAP_MS.
function useRosterAnnouncement(peers) {
  const [text, setText] = useState('')
  const st = useRef({ prev: null, queue: { joined: [], left: [] }, at: 0, timer: null })

  useEffect(() => {
    const s = st.current
    const was = s.prev
    s.prev = peers
    if (was === null) return // the first roster is not news
    const ch = rosterChanges(was, peers)
    if (!ch.joined.length && !ch.left.length) return
    s.queue.joined.push(...ch.joined)
    s.queue.left.push(...ch.left)
    if (s.timer !== null) return // already scheduled: it will carry these too
    const release = () => {
      s.timer = null
      s.at = Date.now()
      const out = announceText(s.queue)
      s.queue = { joined: [], left: [] }
      if (out) setText(out)
    }
    const wait = s.at + ANNOUNCE_GAP_MS - Date.now()
    if (wait <= 0) release()
    else s.timer = setTimeout(release, wait)
  }, [peers])

  useEffect(() => () => clearTimeout(st.current.timer), [])
  return text
}

export default function Presence({ presence, me }) {
  const store = presence ?? NO_PRESENCE
  const peers = useSyncExternalStore(store.subscribe, store.getPeers, () => EMPTY)
  const said = useRosterAnnouncement(peers)
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const button = useRef(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!root.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  useEffect(() => { if (!peers.length) setOpen(false) }, [peers.length])

  const n = peers.length + 1
  return (
    <div
      ref={root}
      className="bd-presence"
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); button.current?.focus() } }}
      // Close when focus moves to something focusable outside; a click on plain content (relatedTarget null) is the
      // pointerdown handler's business, and must not close it while a scrollbar or the padding is being used.
      onBlur={(e) => { if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget)) setOpen(false) }}
    >
      {peers.length > 0 && (
        <>
          <button
            ref={button}
            type="button"
            className="bd-presence-btn"
            aria-label={`${n} people here`}
            aria-expanded={open}
            aria-controls={listId}
            title="Who is here"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="bd-presence-stack" aria-hidden="true">
              {peers.slice(0, SHOWN).map((p) => (
                <span key={p.id} className="bd-presence-av" style={{ '--bd-pc': personColor(p.avatar) }}><Avatar avatar={p.avatar} name={p.name} size={28} decorative /></span>
              ))}
              {peers.length > SHOWN && <span className="bd-presence-more">+{peers.length - SHOWN}</span>}
            </span>
            <span className="bd-presence-count" aria-hidden="true">{n}</span>
          </button>
          {open && (
            <div id={listId} className="bd-presence-pop" role="group" aria-label="People here">
              <ul>
                {me && (
                  <li className="is-me">
                    <Avatar avatar={me.avatar} name={me.name} size={28} decorative />
                    <span className="bd-presence-name"><b>You</b> <span className="bd-presence-sub">{me.name}</span></span>
                  </li>
                )}
                {peers.map((p) => (
                  <li key={p.id}>
                    <Avatar avatar={p.avatar} name={p.name} size={28} decorative />
                    <span className="bd-presence-name">{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="bd-vh" role="status" aria-live="polite">{said}</div>
    </div>
  )
}
