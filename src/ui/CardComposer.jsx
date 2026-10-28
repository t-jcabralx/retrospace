'use client'
// The "Add a card" dialog: message, signature, colour, an optional GIF or photo, and a live preview of the card. Posting is
// the normal add op (cardOps.js); the limits are the server's own (checkCardText), so what the form accepts is accepted.
// It is a modal dialog: focus moves in and is kept in, Esc closes (back to the card from the GIF step), the board behind is
// inert and focus returns to the button that opened it.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModal } from './boards/useModal.js'
import { CloseIcon } from './icons.jsx'
import GifPicker from './GifPicker.jsx'
import Card from './items/Card.jsx'
import { buildCardOp } from './cardOps.js'
import { fileToImage, ImageTooLarge } from './images.js'
import { NOTE_COLORS, noteColor } from './ops.js'
import { estimateCardHeight, CARD_W } from '../lib/layout.js'
import { checkCardText, MAX_CARD_MESSAGE, MAX_SIGNER } from '../lib/validate.js'

const PHOTO_CHARS = 120 * 1024 // the server caps a card photo at 200 KB
const PHOTO_SIDE = 600 // cards are small; a photo bigger than this only makes the board heavier
const COUNT_NOTE_FROM = 450 // from here a screen reader is told how many characters are left

const clipName = (s) => Array.from(String(s ?? '')).slice(0, MAX_SIGNER).join('')

export default function CardComposer({ ctl, items, draft, onDraft, onClose, openerRef, onPosted }) {
  const root = useRef(null)
  const fileRef = useRef(null)
  const gifBtn = useRef(null)
  const submitting = useRef(false)
  const posted = useRef(false)
  const id = useId()
  const [message, setMessage] = useState(draft?.message ?? '')
  const [signer, setSigner] = useState(draft?.signer ?? clipName(ctl.persona?.name))
  const [color, setColor] = useState(draft?.color ?? 'yellow')
  const [media, setMedia] = useState(draft?.media ?? null)
  const [view, setView] = useState('card') // card | gif
  const [tried, setTried] = useState(false) // errors show after the first attempt to post
  const [photoBusy, setPhotoBusy] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [formError, setFormError] = useState('')

  useModal(root, onClose, openerRef, { inert: '.bd-top, .bd-board' })

  // A closed dialog keeps what was typed for next time (an accidental Esc must not eat a message); a posted card clears it.
  const latest = useRef(null)
  latest.current = { message, signer, color, media }
  useEffect(() => () => onDraft(posted.current ? null : latest.current), [onDraft])

  // Each step puts focus where the person works next.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (view === 'gif') root.current?.querySelector('[data-autofocus]')?.focus()
    else gifBtn.current?.focus()
  }, [view])

  const errors = tried ? checkCardText(message, signer) : {}
  const left = MAX_CARD_MESSAGE - message.length

  async function onPhoto(e) {
    const [file] = [...e.target.files].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    setMediaError('')
    try {
      const { src, w, h } = await fileToImage(file, { maxSide: PHOTO_SIDE, maxChars: PHOTO_CHARS })
      setMedia({ type: 'photo', src, w, h })
    } catch (err) {
      setMediaError(err instanceof ImageTooLarge ? 'That photo is too large. Try a smaller one.' : 'Could not read that photo. Try another file.')
    } finally {
      setPhotoBusy(false)
    }
  }

  function submit(e) {
    e.preventDefault()
    if (submitting.current) return // a double click or Enter+click posts once
    setTried(true)
    setFormError('')
    const bad = checkCardText(message, signer)
    if (bad.message || bad.signer) {
      root.current?.querySelector(bad.message ? `#${CSS.escape(id)}-m` : `#${CSS.escape(id)}-s`)?.focus()
      return
    }
    submitting.current = true
    const op = buildCardOp(items, { message, signer, color, media })
    if (!ctl.local([op])) {
      submitting.current = false
      setFormError('Could not add your card. The board may have just been locked or closed.')
      return
    }
    posted.current = true
    onPosted(op)
    onClose()
  }

  const stageH = estimateCardHeight({ message: message.trim(), hasMedia: Boolean(media), mediaRatio: media?.w / media?.h, width: CARD_W })
  const preview = { message: message.trim() || 'Your message appears here', signer: signer.trim() || 'You', color, ...(media && { [media.type === 'photo' ? 'image' : 'gif']: media.src, mediaW: media.w, mediaH: media.h }) }

  return createPortal(
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={root} className="bd-cc" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}>
        {view === 'gif' ? (
          <GifPicker onBack={() => setView('card')} onPick={(g) => { setMedia({ type: 'gif', src: g.url, w: g.w, h: g.h }); setMediaError(''); setView('card') }} />
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="bd-cc-head">
              <h2 id={`${id}-t`} className="bd-cc-title">Add a card</h2>
              <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close" onClick={onClose}><CloseIcon /></button>
            </div>
            <div className="bd-cc-grid">
              <div className="bd-cc-fields">
                <div className="bd-set-item">
                  <label className="bd-set-label" htmlFor={`${id}-m`}>Your message</label>
                  <textarea
                    id={`${id}-m`}
                    className="bd-sinput bd-cc-text"
                    rows={4}
                    maxLength={MAX_CARD_MESSAGE}
                    value={message}
                    data-autofocus
                    aria-invalid={errors.message ? 'true' : undefined}
                    aria-describedby={`${id}-mc ${id}-me`}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
                  />
                  <div className="bd-cc-meta">
                    <p id={`${id}-me`} className="bd-set-error" aria-live="polite">{errors.message ?? ''}</p>
                    <span id={`${id}-mc`} className={`bd-cc-count${left <= 20 ? ' is-low' : ''}`} aria-hidden="true">{message.length}/{MAX_CARD_MESSAGE}</span>
                  </div>
                  <span className="bd-vh" role="status" aria-live="polite">{message.length >= COUNT_NOTE_FROM ? `${left} characters left` : ''}</span>
                </div>
                <div className="bd-set-item">
                  <label className="bd-set-label" htmlFor={`${id}-s`}>Signed as</label>
                  <input
                    id={`${id}-s`}
                    className="bd-sinput"
                    type="text"
                    maxLength={MAX_SIGNER}
                    autoComplete="off"
                    value={signer}
                    aria-invalid={errors.signer ? 'true' : undefined}
                    aria-describedby={`${id}-sh ${id}-se`}
                    onChange={(e) => setSigner(e.target.value)}
                  />
                  <p id={`${id}-sh`} className="bd-set-desc">Shown on your card</p>
                  <p id={`${id}-se`} className="bd-set-error" aria-live="polite">{errors.signer ?? ''}</p>
                </div>
                <div className="bd-set-item" role="group" aria-label="Card colour">
                  <p className="bd-set-label" aria-hidden="true">Colour</p>
                  <div className="bd-cc-swatches">
                    {NOTE_COLORS.map((c) => (
                      <button key={c} type="button" className={`bd-cc-swatch${color === c ? ' is-on' : ''}`} aria-pressed={color === c} aria-label={`Colour ${c}`} title={c} onClick={() => setColor(c)}>
                        <span style={{ background: noteColor(c) }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bd-set-item">
                  <p className="bd-set-label" id={`${id}-ml`}>Picture</p>
                  <div className="bd-set-actions" role="group" aria-labelledby={`${id}-ml`}>
                    <button ref={gifBtn} type="button" className="bd-sbtn" onClick={() => setView('gif')}>{media?.type === 'gif' ? 'Change GIF' : 'Add a GIF'}</button>
                    <button type="button" className="bd-sbtn" disabled={photoBusy} onClick={() => fileRef.current?.click()}>{photoBusy ? 'Preparing…' : media?.type === 'photo' ? 'Change photo' : 'Add a photo'}</button>
                    {media && <button type="button" className="bd-sbtn" onClick={() => { setMedia(null); setMediaError('') }}>Remove {media.type === 'photo' ? 'photo' : 'GIF'}</button>}
                  </div>
                  <p className="bd-set-error" role="alert">{mediaError}</p>
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
                </div>
              </div>
              <div className="bd-cc-previewcol" aria-hidden="true">
                <p className="bd-set-label">Preview</p>
                <div className="bd-cc-stage">
                  <div className="bd-cc-card" style={{ width: CARD_W, height: stageH }}><Card item={{ data: preview }} /></div>
                </div>
              </div>
            </div>
            <p className="bd-set-error" role="alert">{formError}</p>
            <div className="bd-set-actions bd-cc-actions">
              <button type="button" className="bd-sbtn" onClick={onClose}>Cancel</button>
              <button type="submit" className="bd-sbtn is-primary">Post card</button>
            </div>
          </form>
        )}
      </div>
    </>,
    document.body,
  )
}
