'use client'
// How the viewer appears on a board: a generated anonymous persona (default), or their own name. Both have an avatar
// picker. The server is the only authority (names are unique, anonymous ones must come from the word lists); the checks
// here only give feedback while typing. onSubmit(persona) -> null on success, else { error, status, suggestion? }.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Avatar from './Avatar.jsx'
import AvatarPicker from './AvatarPicker.jsx'
import { ShuffleIcon } from './icons.jsx'
import { generatePersona, randomAvatar, validatePersona } from '../lib/persona.js'
import { getNameDraft, setNameDraft } from '../client/identity.js'

// current: the viewer's persona when changing it. accountName: set for the signed-in owner, whose "own" persona is
// their account name. participants: [{ uid, name, ... }] for the live name check; selfUid is left out of it.
export default function PersonaChooser({ boardTitle, participants = [], selfUid, current = null, accountName = null, mode = 'join', onSubmit, onCancel }) {
  const ids = { title: useId(), name: useId(), hint: useId(), err: useId() }
  const taken = useMemo(() => new Set(participants.filter((p) => p.uid !== selfUid).map((p) => p.name)), [participants, selfUid])
  const first = accountName ? 'account' : 'anonymous'
  const [choice, setChoice] = useState(() => (current?.kind === 'custom' ? 'custom' : current?.kind === 'account' ? 'account' : first))
  const [anon, setAnon] = useState(() => (current?.kind === 'anonymous' ? current : generatePersona(Math.random, taken)))
  const [custom, setCustom] = useState(() => ({ name: current?.kind === 'custom' ? current.name : getNameDraft(), avatar: current?.kind === 'custom' ? current.avatar : randomAvatar() }))
  const [account, setAccount] = useState(() => (current?.kind === 'account' ? current.avatar : randomAvatar()))
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('') // the server refused the custom name (taken)
  const [busy, setBusy] = useState(false)
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [])

  const options = accountName ? ['account', 'custom'] : ['anonymous', 'custom']
  const customCheck = validatePersona({ kind: 'custom', name: custom.name, avatar: custom.avatar }, { taken })
  const persona = choice === 'anonymous' ? anon
    : choice === 'account' ? { kind: 'account', name: accountName, avatar: account }
    : customCheck.ok ? customCheck.persona : null
  const nameError = choice === 'custom' ? (!customCheck.ok && (touched || Array.from(custom.name.trim()).length >= 2) ? customCheck.error : fieldError) : ''
  const label = persona ? persona.name : ''
  const verb = mode === 'join' ? 'Join as' : 'Save as'

  async function submit(e) {
    e.preventDefault()
    if (!persona || busy) return
    setBusy(true)
    setError('')
    setFieldError('')
    let res = await onSubmit(persona)
    if (res?.status === 409 && choice === 'anonymous' && res.suggestion) { // someone just took it: take the offered name and go on
      const next = { ...persona, name: res.suggestion }
      setAnon(next)
      res = await onSubmit(next)
    }
    if (res) {
      if (res.status === 409 && choice === 'custom') setFieldError(res.error)
      else setError(res.error || 'Something went wrong. Try again.')
      setBusy(false)
      return
    }
    if (choice === 'custom') setNameDraft(custom.name)
  }

  const shuffleAnon = () => setAnon(generatePersona(Math.random, taken))

  return (
    <form className="pa-card" onSubmit={submit} aria-labelledby={ids.title} noValidate>
      <h1 id={ids.title} ref={heading} tabIndex={-1}>{mode === 'join' ? 'How do you want to appear?' : 'Change how you appear'}</h1>
      <p className="pa-lede">
        {boardTitle ? <>Others on <strong>{boardTitle}</strong> will see this on your notes.</> : 'Others will see this on your notes.'}
        {' '}You can change it until you add something.
      </p>

      <fieldset className="pa-options">
        <legend className="bd-vh">Choose how you appear</legend>

        {options.map((opt) => {
          const on = choice === opt
          const isAnon = opt === 'anonymous'
          const isAccount = opt === 'account'
          return (
            <div key={opt} className={`pa-option${on ? ' is-on' : ''}`}>
              <label className="pa-option-head">
                <input type="radio" name="pa-choice" value={opt} checked={on} onChange={() => { setChoice(opt); setError(''); setFieldError('') }} />
                <span className="pa-option-text">
                  <span className="pa-option-title">{isAnon ? 'Stay anonymous' : isAccount ? 'Use my account name' : (accountName ? 'Use a different name' : 'Use my own name')}</span>
                  <span className="pa-option-sub">{isAnon ? 'A friendly random name and avatar' : isAccount ? accountName : 'Pick a name and an avatar'}</span>
                </span>
              </label>

              {on && isAnon && (
                <div className="pa-option-body">
                  <div className="pa-who">
                    <Avatar avatar={anon.avatar} name={anon.name} size={72} />
                    <div className="pa-who-text">
                      <span className="pa-who-name" aria-live="polite">{anon.name}</span>
                      <button type="button" className="pa-btn" onClick={shuffleAnon} aria-label="Shuffle name and avatar"><ShuffleIcon /> Shuffle</button>
                    </div>
                  </div>
                  <AvatarPicker avatar={anon.avatar} name={anon.name} showPreview={false} showShuffle={false} onChange={(avatar) => setAnon({ ...anon, avatar })} />
                </div>
              )}

              {on && isAccount && (
                <div className="pa-option-body">
                  <AvatarPicker avatar={account} name={accountName} onChange={setAccount} />
                </div>
              )}

              {on && opt === 'custom' && (
                <div className="pa-option-body">
                  <div className="bd-field">
                    <label htmlFor={ids.name}>Your name</label>
                    <input
                      id={ids.name}
                      className="bd-input"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      value={custom.name}
                      onChange={(e) => { setCustom({ ...custom, name: e.target.value }); setError(''); setFieldError('') }}
                      onBlur={() => setTouched(true)}
                      aria-invalid={nameError ? 'true' : undefined}
                      aria-describedby={`${ids.hint} ${ids.err}`}
                    />
                    <p id={ids.hint} className="pa-hint">2 to 24 characters, unique on this board.</p>
                    <p id={ids.err} className="pa-error" role="status">{nameError}</p>
                  </div>
                  <AvatarPicker avatar={custom.avatar} name={custom.name.trim() || 'You'} onChange={(avatar) => setCustom({ ...custom, avatar })} />
                </div>
              )}
            </div>
          )
        })}
      </fieldset>

      <p className="pa-error pa-error-submit" role="alert">{error}</p>
      <div className="pa-actions">
        {onCancel && <button type="button" className="pa-btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="pa-btn pa-primary" disabled={!persona || busy} aria-disabled={!persona || busy}>
          {busy ? 'Just a moment…' : persona ? `${verb} ${label}` : mode === 'join' ? 'Join' : 'Save'}
        </button>
      </div>
    </form>
  )
}

// The chooser in a modal, for changing a persona from the top bar. Escape and Cancel close it; Tab stays inside.
export function PersonaDialog({ onClose, ...props }) {
  const box = useRef(null)
  const [previous] = useState(() => document.activeElement) // read while rendering: the chooser moves focus in its own effect
  useEffect(() => () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }, [previous])

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    if (e.key !== 'Tab') return
    const items = [...box.current.querySelectorAll('button:not([disabled]), input, [tabindex="0"]')].filter((el) => !el.closest('[hidden]') && el.tabIndex >= 0)
    if (!items.length) return
    const [a, z] = [items[0], items.at(-1)]
    if (e.shiftKey && (document.activeElement === a || document.activeElement === box.current.querySelector('h1'))) { e.preventDefault(); z.focus() }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
  }

  return (
    <div className="pa-overlay" onKeyDown={onKeyDown} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pa-dialog" role="dialog" aria-modal="true" aria-label="Change how you appear" ref={box}>
        <PersonaChooser {...props} mode="change" onCancel={onClose} />
      </div>
    </div>
  )
}
