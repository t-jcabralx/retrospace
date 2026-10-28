'use client'
// Gate for a passcode-protected board: shows which board it is (from the public join info), then asks for the passcode.
import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { typeInfo } from '../lib/boardTypes.js'
import { getJson } from './site/api.js'
import { typeIcon } from './site/icons.jsx'
import PasswordField from './auth/PasswordField.jsx'
import './site/site.css'

export default function PasscodePanel({ code, onSubmit }) {
  const [info, setInfo] = useState(null) // { title, type } once /api/join/<code> answers; the gate works without it
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = useId()
  const errorId = useId()

  useEffect(() => {
    let off = false
    getJson(`/api/join/${code}`).then((r) => { if (!off && r.ok && r.data?.exists) setInfo({ title: r.data.title, type: r.data.type }) })
    return () => { off = true }
  }, [code])

  async function submit(e) {
    e.preventDefault()
    if (!value || busy) return
    setBusy(true)
    setError('')
    const message = await onSubmit(value)
    if (message) { setError(message); setBusy(false) } // on success the board loads and this panel goes away
  }

  const Icon = info ? typeIcon(info.type) : null
  return (
    <div className="rs-page">
      <main id="main" className="rs-main rs-center" tabIndex={-1}>
        <form className="rs-card rs-auth" onSubmit={submit} noValidate>
          <h1>Enter the passcode</h1>
          <p className="rs-auth-lede">This board is protected. Ask the person who shared it for the passcode.</p>
          {info && (
            <div className="rs-board-line">
              <Icon width={28} height={28} aria-hidden="true" />
              <div>
                <strong>{info.title}</strong>
                <span>{typeInfo(info.type).short} board</span>
              </div>
            </div>
          )}
          <div className="rs-field">
            <label className="rs-label" htmlFor={inputId}>Passcode</label>
            <PasswordField
              id={inputId}
              name="passcode"
              autoComplete="off"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={errorId}
            />
            <p className="rs-error" id={errorId} role="alert">{error}</p>
          </div>
          <button type="submit" className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" disabled={!value || busy}>
            {busy ? <><span className="rs-spin" aria-hidden="true" />Checking…</> : 'Join'}
          </button>
          <p className="rs-auth-switch"><Link className="rs-link" href="/join">Join another board</Link></p>
          <p className="rs-auth-back"><Link href="/">Back to home</Link></p>
        </form>
      </main>
    </div>
  )
}
