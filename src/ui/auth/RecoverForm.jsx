'use client'
// Forgot password and Choose a new password: the two screens of an emailed reset link. The server rules live in the
// /api/auth/forgot and /api/auth/reset routes; these forms only give quick feedback.
import { useId, useState } from 'react'
import Link from 'next/link'
import { checkEmail, MIN_PASSWORD, MAX_PASSWORD } from '../../lib/validate.js'
import { authMessage, RULE_TEXT } from '../../lib/authRules.js'
import { postJson } from '../site/api.js'
import PasswordField from './PasswordField.jsx'

const Busy = ({ text }) => <><span className="rs-spin" aria-hidden="true" />{text}</>

export function ForgotForm() {
  const id = useId()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!email.trim()) return setError('Enter your email address')
    if (!checkEmail(email).ok) return setError('Enter a valid email address, like name@example.com')
    setError('')
    setBusy(true)
    const r = await postJson('/api/auth/forgot', { email: email.trim() })
    setBusy(false)
    if (r.ok) return setDone(true)
    setError(authMessage('forgot', r.status, r.retryAfter, r.data?.error).text)
  }

  if (done) {
    return (
      <div className="rs-card rs-auth" role="status">
        <h1>Check your email</h1>
        <p className="rs-auth-lede">If that address has an account, we have sent a link to choose a new password. It works for 30 minutes. Look in your spam folder if it does not arrive.</p>
        <p className="rs-auth-back"><Link href="/login">Back to sign in</Link></p>
      </div>
    )
  }
  return (
    <div className="rs-card rs-auth">
      <h1>Forgot your password?</h1>
      <p className="rs-auth-lede">Enter your email and we will send you a link to choose a new one.</p>
      <form onSubmit={submit} noValidate>
        <div aria-live="assertive" aria-atomic="true" className="rs-live">{error && <div className="rs-alert">{error}</div>}</div>
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} className="rs-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus required value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} />
        </div>
        <button type="submit" className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" disabled={busy}>
          {busy ? <Busy text="Sending…" /> : 'Send reset link'}
        </button>
      </form>
      <p className="rs-auth-switch">Remembered it? <Link className="rs-link" href="/login">Sign in</Link></p>
    </div>
  )
}

export function ResetForm({ token }) {
  const id = useId()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [gone, setGone] = useState(!token)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!password) return setError('Choose a password')
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters`)
    if (password.length > MAX_PASSWORD) return setError(`Use at most ${MAX_PASSWORD} characters`)
    setError('')
    setBusy(true)
    const r = await postJson('/api/auth/reset', { token, password })
    setBusy(false)
    if (r.ok) return setDone(true)
    if (r.status === 400 && /expired or was already used/.test(r.data?.error ?? '')) return setGone(true)
    setError(authMessage('reset', r.status, r.retryAfter, r.data?.error).text)
  }

  if (done) {
    return (
      <div className="rs-card rs-auth" role="status">
        <h1>Password changed</h1>
        <p className="rs-auth-lede">You have been signed out everywhere. Sign in with your new password.</p>
        <Link className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" href="/login">Sign in</Link>
      </div>
    )
  }
  if (gone) {
    return (
      <div className="rs-card rs-auth" role="alert">
        <h1>This link no longer works</h1>
        <p className="rs-auth-lede">It has expired or was already used. Ask for a new one.</p>
        <Link className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" href="/forgot">Get a new link</Link>
      </div>
    )
  }
  return (
    <div className="rs-card rs-auth">
      <h1>Choose a new password</h1>
      <form onSubmit={submit} noValidate>
        <div aria-live="assertive" aria-atomic="true" className="rs-live">{error && <div className="rs-alert">{error}</div>}</div>
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-password`}>New password</label>
          <PasswordField id={`${id}-password`} name="password" autoComplete="new-password" autoFocus required value={password} onChange={(e) => { setPassword(e.target.value); setError('') }} aria-describedby={`${id}-hint`} />
          <p className="rs-hint" id={`${id}-hint`}>{RULE_TEXT.password}</p>
        </div>
        <button type="submit" className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" disabled={busy}>
          {busy ? <Busy text="Saving…" /> : 'Change password'}
        </button>
      </form>
    </div>
  )
}
