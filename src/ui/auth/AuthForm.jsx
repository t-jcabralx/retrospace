'use client'
// Sign in and sign up. The rules live in lib/authRules.js (mirroring the server); this file is the form.
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { checkAuth, authMessage, RULE_TEXT } from '../../lib/authRules.js'
import { safeNext, loginHref, registerHref } from '../../lib/nav.js'
import { postJson } from '../site/api.js'
import { useAuth, setSignedIn } from '../site/useAuth.js'
import PasswordField from './PasswordField.jsx'

const COPY = {
  login: {
    title: 'Welcome back', lede: 'Sign in to manage your boards.', submit: 'Sign in', busy: 'Signing in…',
    switchText: 'New to Retrospace?', switchLabel: 'Create an account', switchHref: registerHref, url: '/api/auth/login',
  },
  register: {
    title: 'Create your account', lede: 'Set up a board in a minute. Guests who join with your code don’t need an account.', submit: 'Create account', busy: 'Creating account…',
    switchText: 'Already have an account?', switchLabel: 'Sign in', switchHref: loginHref, url: '/api/auth/register',
  },
}

export default function AuthForm({ mode, next }) {
  const copy = COPY[mode]
  const register = mode === 'register'
  const router = useRouter()
  const auth = useAuth()
  const id = useId()
  const refs = { name: useRef(null), email: useRef(null), password: useRef(null) }
  const [values, setValues] = useState({ name: '', email: '', password: '' })
  const [blurred, setBlurred] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [server, setServer] = useState(null)
  const [focusReq, setFocusReq] = useState(null) // { field, n }: focus this field once the render that shows its error has committed
  const leaving = useRef(false)

  const errors = checkAuth(mode, values)
  const visible = (field) => (submitted || blurred[field] ? errors[field] : undefined)

  useEffect(() => {
    if (auth.status === 'in' && !leaving.current) {
      leaving.current = true
      router.replace(safeNext(next))
    }
  }, [auth.status, next, router])

  useEffect(() => { if (focusReq) refs[focusReq.field].current?.focus() }, [focusReq]) // eslint-disable-line react-hooks/exhaustive-deps

  const askFocus = (field) => setFocusReq((r) => ({ field, n: (r?.n ?? 0) + 1 }))
  const set = (field) => (e) => { setValues((v) => ({ ...v, [field]: e.target.value })); setServer(null) }
  const blur = (field) => () => setBlurred((b) => ({ ...b, [field]: true }))

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setSubmitted(true)
    const first = ['name', 'email', 'password'].find((f) => errors[f])
    if (first) { askFocus(first); return }
    setBusy(true)
    setServer(null)
    const body = { email: values.email.trim(), password: values.password, ...(register ? { name: values.name } : {}) }
    const r = await postJson(copy.url, body)
    if (r.ok && r.data?.user) {
      leaving.current = true
      setSignedIn(r.data.user)
      router.replace(safeNext(next)) // stay busy until the page changes
      return
    }
    const msg = authMessage(mode, r.status, r.retryAfter, r.data?.error)
    if (r.status === 409) msg.link.href = loginHref(next)
    setServer(msg)
    setBusy(false)
    if (r.status === 409) askFocus('email')
    else if (r.status === 401) askFocus('password')
  }

  if (auth.status === 'in') return <div className="rs-card rs-auth" role="status"><p className="rs-auth-lede" style={{ margin: 0 }}>You are signed in. Taking you to your boards…</p></div>

  const field = (name) => ({
    id: `${id}-${name}`,
    name,
    value: values[name],
    onChange: set(name),
    onBlur: blur(name),
    required: true,
    'aria-invalid': visible(name) ? 'true' : undefined,
    // The error element always exists (empty until there is an error), so it can be part of the description from the start.
    'aria-describedby': [`${id}-${name}-error`, name === 'password' && register ? `${id}-password-hint` : null, name === 'name' ? `${id}-name-hint` : null].filter(Boolean).join(' '),
  })
  const error = (name) => <p className="rs-error" id={`${id}-${name}-error`}>{visible(name) ?? ''}</p>

  return (
    <div className="rs-card rs-auth">
      <h1>{copy.title}</h1>
      <p className="rs-auth-lede">{copy.lede}</p>
      <form onSubmit={submit} noValidate>
        <div aria-live="assertive" aria-atomic="true" className="rs-live">
          {server && (
            <div className="rs-alert">
              {server.text}
              {server.link && <Link href={server.link.href}>{server.link.label}</Link>}
            </div>
          )}
        </div>
        {register && (
          <div className="rs-field">
            <label className="rs-label" htmlFor={`${id}-name`}>Name</label>
            <input ref={refs.name} className="rs-input" type="text" autoComplete="name" autoFocus {...field('name')} />
            <p className="rs-hint" id={`${id}-name-hint`}>{RULE_TEXT.name}</p>
            {error('name')}
          </div>
        )}
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-email`}>Email</label>
          <input ref={refs.email} className="rs-input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={!register} {...field('email')} />
          {error('email')}
        </div>
        <div className="rs-field">
          <label className="rs-label" htmlFor={`${id}-password`}>Password</label>
          <PasswordField inputRef={refs.password} autoComplete={register ? 'new-password' : 'current-password'} {...field('password')} />
          {register && <p className="rs-hint" id={`${id}-password-hint`}>{RULE_TEXT.password}</p>}
          {error('password')}
        </div>
        <button type="submit" className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" disabled={busy}>
          {busy ? <><span className="rs-spin" aria-hidden="true" />{copy.busy}</> : copy.submit}
        </button>
      </form>
      <p className="rs-auth-switch">{copy.switchText} <Link className="rs-link" href={copy.switchHref(next)}>{copy.switchLabel}</Link></p>
      <p className="rs-auth-back"><Link href="/">Back to home</Link></p>
    </div>
  )
}
