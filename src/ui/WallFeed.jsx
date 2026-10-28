'use client'
// The wall's default view: shout-outs newest first, thirty at a time, each with its reaction bar. The owner may delete
// any shout-out, everyone else only their own (the server decides; the button only shows where it will work).
import { useEffect, useRef, useState } from 'react'
import Shoutout from './items/Shoutout.jsx'
import ShoutoutComposer from './ShoutoutComposer.jsx'
import { REACTIONS } from '../lib/validate.js'
import { feedItems, feedPage, FEED_PAGE } from '../lib/wall.js'
import './wall.css'

function ReactionBar({ item, uid, disabled, onReact }) {
  return (
    <div className="wl-reacts" role="group" aria-label="Reactions">
      {REACTIONS.map((emoji) => {
        const uids = item.reactions?.[emoji] ?? []
        const mine = Boolean(uid) && uids.includes(uid)
        return (
          <button
            key={emoji}
            type="button"
            className={`wl-react${mine ? ' is-mine' : ''}`}
            aria-pressed={mine}
            aria-label={`${emoji} ${uids.length} ${uids.length === 1 ? 'reaction' : 'reactions'}`}
            disabled={disabled}
            onClick={() => onReact(emoji)}
          >
            <span aria-hidden="true">{emoji}</span>{uids.length > 0 && <span className="wl-react-n" aria-hidden="true">{uids.length}</span>}
          </button>
        )
      })}
    </div>
  )
}

// The names a guest may @mention (never birthdays or start dates: those stay the owner's). Fetched when the composer opens.
function usePeopleNames(code, wanted) {
  const [people, setPeople] = useState([])
  useEffect(() => {
    if (!wanted) return undefined
    let dead = false
    fetch(`/api/boards/${code}/people-names`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => { if (!dead && Array.isArray(list)) setPeople(list) })
      .catch(() => {})
    return () => { dead = true }
  }, [code, wanted])
  return people
}

export default function WallFeed({ ctl }) {
  const [shown, setShown] = useState(FEED_PAGE)
  const [composing, setComposing] = useState(false)
  const opener = useRef(null)
  const all = feedItems(ctl.items)
  const { visible, hasMore, next } = feedPage(all, shown)
  const people = usePeopleNames(ctl.code, composing)

  return (
    <div className="wl-feed">
      <div className="wl-col">
        <div className="wl-head">
          <h2 className="wl-h">Shout-outs</h2>
          {!ctl.readOnly && (
            <button ref={opener} type="button" className="wl-new" aria-haspopup="dialog" onClick={() => setComposing(true)}>Give a shout-out</button>
          )}
        </div>
        {all.length === 0 && <p className="wl-empty">{ctl.readOnly ? 'No shout-outs yet.' : 'No shout-outs yet. Be the first to recognise someone.'}</p>}
        <ol className="wl-list" aria-label="Shout-outs, newest first">
          {visible.map((item) => (
            <li key={item.id} className="wl-entry">
              <Shoutout item={item} />
              <div className="wl-foot">
                <ReactionBar item={item} uid={ctl.uid} disabled={ctl.readOnly} onReact={(emoji) => ctl.local([{ op: 'react', id: item.id, emoji }])} />
                {ctl.canEdit(item) && (
                  <button type="button" className="wl-del" aria-label={`Delete the shout-out to ${item.data.toName}`} onClick={() => { ctl.local([{ op: 'delete', id: item.id }]); ctl.notify('Shout-out deleted. Undo is in the top bar.') }}>Delete</button>
                )}
              </div>
            </li>
          ))}
        </ol>
        {hasMore && <button type="button" className="wl-more" onClick={() => setShown(next)}>Load more ({all.length - visible.length} left)</button>}
      </div>
      {composing && (
        <ShoutoutComposer ctl={ctl} people={people} items={ctl.items} openerRef={opener} onClose={() => setComposing(false)} onPosted={() => ctl.notify('Shout-out posted')} />
      )}
    </div>
  )
}
