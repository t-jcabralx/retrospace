'use client'
// The "Report an issue" form. The rules are enforced by /api/issue (lib/issueReport.js); this only gives quick feedback.
import { useId, useState } from 'react'
import Link from 'next/link'
import { MIN_REPORT, MAX_REPORT } from '../../lib/issueLimits.js'
import { checkEmail } from '../../lib/validate.js'
import { postJson } from './api.js'

export default function IssueForm() {
  const id = useId()
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // hidden: only a bot fills it in
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const text = message.trim()
    if (text.length < MIN_REPORT) return setError(`Describe the problem in at least ${MIN_REPORT} characters`)
    if (text.length > MAX_REPORT) return setError(`Keep it under ${MAX_REPORT} characters`)
    if (email.trim() && !checkEmail(email).ok) return setError('That email address does not look right')
    setError('')
    setBusy(true)
    const r = await postJson('/api/issue', { message: text, email: email.trim(), website })
    setBusy(false)
    if (r.ok) return setDone(true)
    setError(r.status === 0 ? 'Could not reach the server. Check your connection and try again.' : r.data?.error || 'Something went wrong. Please try again.')
  }

  if (done) {
    return (
      <div className="rs-card rs-auth is-issue" role="status">
        <h1>Thank you</h1>
        <p className="rs-auth-lede">Your report was sent. {email.trim() ? 'If we need more detail we will reply to the address you gave.' : 'You left no email, so we cannot reply, but we will read it.'}</p>
        <p className="rs-auth-back"><Link href="/">Back to home</Link></p>
      </div>
    )
  }
  return (
    <div className="rs-card rs-auth is-issue">
      <h1>Report an issue</h1>
      <p className="rs-auth-lede">Something broken or confusing? Tell us what happened and what you expected. Please do not include passwords or board access codes.</p>
      <form onSubmit={submit} noValidate>
        <div aria-live="assertive" aria-atomic="true" className="rs-live">{error && <div className="rs-alert">{error}</div>}</div>
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-message`}>What went wrong?</label>
          <textarea id={`${id}-message`} className="rs-input is-text" rows={6} maxLength={MAX_REPORT} required autoFocus value={message} onChange={(e) => { setMessage(e.target.value); setError('') }} />
          <p className="rs-hint">{message.trim().length} / {MAX_REPORT}</p>
        </div>
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-email`}>Your email <span className="rs-hint">(optional, so we can reply)</span></label>
          <input id={`${id}-email`} className="rs-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} />
        </div>
        <div className="is-trap" aria-hidden="true">
          <label>Leave this empty<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
        </div>
        <button type="submit" className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" disabled={busy}>
          {busy ? <><span className="rs-spin" aria-hidden="true" />Sending…</> : 'Send report'}
        </button>
      </form>
    </div>
  )
}
