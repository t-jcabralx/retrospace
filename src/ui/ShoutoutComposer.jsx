'use client'
// The "Give a shout-out" dialog: who it is for (typed, or picked from the team with @), a message, a badge, an optional GIF
// and a live preview. Posting is the normal add op (shoutoutOps.js); the limits are the server's (checkShoutout in wall.js).
// A modal dialog like the card composer: focus moves in and is kept in, Esc closes, focus returns to the opener.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from './boards/useModal.js'
import { CloseIcon } from './icons.jsx'
import GifPicker from './GifPicker.jsx'
import Shoutout, { BADGE_EMOJI } from './items/Shoutout.jsx'
import { buildShoutoutOp } from './shoutoutOps.js'
import { BADGES } from '../lib/validate.js'
import { checkShoutout, matchPeople, MAX_SHOUT_MESSAGE, MAX_TO_NAME } from '../lib/wall.js'
import './cards.css'
import './wall.css'

export default function ShoutoutComposer({ ctl, people, items, openerRef, onClose, onPosted }) {
  const root = useRef(null)
  const gifBtn = useRef(null)
  const submitting = useRef(false)
  const id = useId()
  const [toName, setToName] = useState('')
  const [to, setTo] = useState(null) // the person id when picked from the list
  const [message, setMessage] = useState('')
  const [badge, setBadge] = useState(BADGES[0])
  const [gif, setGif] = useState(null)
  const [view, setView] = useState('form') // form | gif
  const [tried, setTried] = useState(false)
  const [formError, setFormError] = useState('')
  const [open, setOpen] = useState(false) // mention list
  const [active, setActive] = useState(0)

  useModal(root, onClose, openerRef, { inert: '.bd-top, .bd-board, .wl-wrap' })

  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (view === 'gif') root.current?.querySelector('[data-autofocus]')?.focus()
    else gifBtn.current?.focus()
  }, [view])

  const matches = open && !to && toName.trim() ? matchPeople(people, toName) : []
  const errors = tried ? checkShoutout({ toName, message }) : {}
  const left = MAX_SHOUT_MESSAGE - message.length

  function pick(p) {
    setToName(p.name.slice(0, MAX_TO_NAME))
    setTo(p.id)
    setOpen(false)
  }

  function onToKey(e) {
    if (!matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a + matches.length - 1) % matches.length) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[Math.min(active, matches.length - 1)]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } // closes the list, not the dialog
  }

  function submit(e) {
    e.preventDefault()
    if (submitting.current) return // a double click or Enter+click posts once
    setTried(true)
    setFormError('')
    const bad = checkShoutout({ toName, message })
    if (bad.toName || bad.message) {
      root.current?.querySelector(`#${CSS.escape(id)}-${bad.toName ? 't' : 'm'}`)?.focus()
      return
    }
    submitting.current = true
    const op = buildShoutoutOp(items, { toName, to, message, badge, gif: gif?.src }, undefined)
    if (!ctl.local([op])) {
      submitting.current = false
      setFormError('Could not post your shout-out. The board may have just been locked or closed.')
      return
    }
    onPosted(op)
    onClose()
  }

  const preview = { toName: toName.trim() || 'someone', message: message.trim() || 'Your message appears here', badge, ...(to && { to }), ...(gif && { gif: gif.src }) }

  return createPortal(
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={root} className="bd-cc wl-composer" role="dialog" aria-modal="true" aria-labelledby={`${id}-h`} tabIndex={-1}>
        {view === 'gif' ? (
          <GifPicker onBack={() => setView('form')} onPick={(g) => { setGif({ src: g.url }); setView('form') }} />
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="bd-cc-head">
              <h2 id={`${id}-h`} className="bd-cc-title">Give a shout-out</h2>
              <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close" onClick={onClose}><CloseIcon /></button>
            </div>
            <div className="bd-cc-grid">
              <div className="bd-cc-fields">
                <div className="bd-set-item wl-to-field">
                  <label className="bd-set-label" htmlFor={`${id}-t`}>Who is it for?</label>
                  <input
                    id={`${id}-t`}
                    className="bd-sinput"
                    type="text"
                    role="combobox"
                    aria-expanded={matches.length > 0}
                    aria-controls={`${id}-list`}
                    aria-autocomplete="list"
                    aria-activedescendant={matches.length ? `${id}-o${Math.min(active, matches.length - 1)}` : undefined}
                    aria-invalid={errors.toName ? 'true' : undefined}
                    aria-describedby={`${id}-th ${id}-te`}
                    maxLength={MAX_TO_NAME}
                    autoComplete="off"
                    value={toName}
                    data-autofocus
                    onChange={(e) => { setToName(e.target.value); setTo(null); setOpen(true); setActive(0) }}
                    onKeyDown={onToKey}
                    onBlur={() => setTimeout(() => setOpen(false), 120)}
                  />
                  {matches.length > 0 && (
                    <ul id={`${id}-list`} className="wl-mentions" role="listbox" aria-label="People">
                      {matches.map((p, i) => (
                        <li key={p.id} id={`${id}-o${i}`} role="option" aria-selected={i === Math.min(active, matches.length - 1)} className={i === Math.min(active, matches.length - 1) ? 'is-on' : undefined} onMouseDown={(e) => { e.preventDefault(); pick(p) }}>
                          @{p.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p id={`${id}-th`} className="bd-set-desc">Type a name{people.length ? ', or the start of a teammate’s name to pick them' : ''}</p>
                  <p id={`${id}-te`} className="bd-set-error" aria-live="polite">{errors.toName ?? ''}</p>
                </div>
                <div className="bd-set-item">
                  <label className="bd-set-label" htmlFor={`${id}-m`}>Your message</label>
                  <textarea
                    id={`${id}-m`}
                    className="bd-sinput bd-cc-text"
                    rows={4}
                    maxLength={MAX_SHOUT_MESSAGE}
                    value={message}
                    aria-invalid={errors.message ? 'true' : undefined}
                    aria-describedby={`${id}-mc ${id}-me`}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
                  />
                  <div className="bd-cc-meta">
                    <p id={`${id}-me`} className="bd-set-error" aria-live="polite">{errors.message ?? ''}</p>
                    <span id={`${id}-mc`} className={`bd-cc-count${left <= 20 ? ' is-low' : ''}`} aria-hidden="true">{message.length}/{MAX_SHOUT_MESSAGE}</span>
                  </div>
                </div>
                <div className="bd-set-item" role="group" aria-labelledby={`${id}-bl`}>
                  <p className="bd-set-label" id={`${id}-bl`}>Badge</p>
                  <div className="wl-badges">
                    {BADGES.map((b) => (
                      <button key={b} type="button" className={`wl-badge-btn${badge === b ? ' is-on' : ''}`} aria-pressed={badge === b} onClick={() => setBadge(b)}>
                        <span aria-hidden="true">{BADGE_EMOJI[b]} </span>{b}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bd-set-item">
                  <p className="bd-set-label" id={`${id}-gl`}>Picture</p>
                  <div className="bd-set-actions" role="group" aria-labelledby={`${id}-gl`}>
                    <button ref={gifBtn} type="button" className="bd-sbtn" onClick={() => setView('gif')}>{gif ? 'Change GIF' : 'Add a GIF'}</button>
                    {gif && <button type="button" className="bd-sbtn" onClick={() => setGif(null)}>Remove GIF</button>}
                  </div>
                </div>
              </div>
              <div className="bd-cc-previewcol" aria-hidden="true">
                <p className="bd-set-label">Preview</p>
                <div className="wl-preview"><Shoutout item={{ data: preview, authorName: ctl.persona?.name }} /></div>
              </div>
            </div>
            <p className="bd-set-error" role="alert">{formError}</p>
            <div className="bd-set-actions bd-cc-actions">
              <button type="button" className="bd-sbtn" onClick={onClose}>Cancel</button>
              <button type="submit" className="bd-sbtn is-primary">Post shout-out</button>
            </div>
          </form>
        )}
      </div>
    </>,
    document.body,
  )
}
