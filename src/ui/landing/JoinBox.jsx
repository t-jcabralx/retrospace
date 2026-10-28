'use client'
// Enter an access code and open that board. Used in the landing hero (goes straight through) and as the body of
// /join (shows what it found first). Everything about a code lives in lib/code.js; this file is the form.
import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizeCode, codeProblem, interpretJoin } from '../../lib/code.js'
import { typeInfo } from '../../lib/boardTypes.js'
import { getJson } from '../site/api.js'
import { typeIcon, ArrowIcon } from '../site/icons.jsx'
import '../site/site.css'

const MAX_TYPED = 12 // a few spare characters so a pasted "K7M-2QX" or "K7M 2QX " is never cut short

export default function JoinBox({ variant = 'hero', initialCode = '' }) {
  const router = useRouter()
  const page = variant === 'page'
  const [value, setValue] = useState(() => normalizeCode(initialCode).slice(0, MAX_TYPED))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null) // { code, board } once /join has looked a code up
  const inputRef = useRef(null)
  const joinRef = useRef(null)
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const titleId = `${id}-title`

  useEffect(() => { if (found) joinRef.current?.focus() }, [found]) // Enter again, or one Tab, and you are in

  function change(e) {
    const input = e.target
    const next = normalizeCode(input.value).slice(0, MAX_TYPED)
    // Normalising can drop characters (a dash, a space) or change case. A controlled input would jump the caret to the
    // end, so put it back after the same number of kept characters it had before.
    const caret = Math.min(normalizeCode(input.value.slice(0, input.selectionStart ?? input.value.length)).length, next.length)
    if (next !== input.value) queueMicrotask(() => input.setSelectionRange?.(caret, caret)) // after React has restored the value
    setValue(next)
    setError('')
    setFound(null)
  }

  const fail = (message) => {
    setError(message)
    setBusy(false)
    inputRef.current?.focus()
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const code = normalizeCode(value)
    const problem = codeProblem(code)
    if (problem) return fail(problem)
    if (found?.code === code) { // the "Join board" step
      setBusy(true)
      router.push(`/b/${code}`)
      return
    }
    setBusy(true)
    setError('')
    const r = await getJson(`/api/join/${code}`)
    if (r.status === 0) return fail('Couldn’t reach the server. Check your connection and try again.')
    const out = interpretJoin(r.status, r.data, r.retryAfter)
    if (out.error) return fail(out.error)
    if (!page) { router.push(`/b/${code}`); return } // stay busy until the board page takes over
    setBusy(false)
    setFound({ code, board: out.board })
  }

  const Icon = found ? typeIcon(found.board.type) : null
  const lookingUp = busy && !found
  return (
    <form className="rs-join" onSubmit={submit} noValidate role="group" aria-labelledby={page ? undefined : titleId}>
      {!page && <p className="rs-join-title" id={titleId}>Join with code</p>}
      <label htmlFor={`${id}-code`} className={page ? 'rs-label' : 'rs-vh'}>Access code</label>
      <div className="rs-join-row">
        <input
          ref={inputRef}
          id={`${id}-code`}
          className="rs-input"
          name="code"
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={page}
          placeholder="K7M2QX"
          value={value}
          onChange={change}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        />
        {!found && (
          <button type="submit" className="rs-btn rs-btn--dark" disabled={busy}>
            {lookingUp ? <><span className="rs-spin" aria-hidden="true" />{page ? 'Looking…' : 'Joining…'}</> : page ? 'Find board' : 'Join'}
          </button>
        )}
      </div>
      <p className="rs-hint" id={hintId}>The 6-character code from your invitation. Dashes and spaces are fine.</p>
      <p className="rs-error" id={errorId} role="alert">{error}</p>
      {found && (
        <div className="rs-join-result" role="status">
          <div className="rs-board-line">
            <Icon width={28} height={28} aria-hidden="true" />
            <div>
              <strong>{found.board.title}</strong>
              <span>{typeInfo(found.board.type).short} board</span>
            </div>
          </div>
          {found.board.needsPasscode && <p className="rs-join-note">This board has a passcode. You will be asked for it next.</p>}
          {found.board.closed && <p className="rs-join-note">This board is closed. You can look around, but only the owner can add to it.</p>}
          <button ref={joinRef} type="submit" className="rs-btn rs-btn--primary rs-btn--lg rs-btn--block" disabled={busy} style={{ marginTop: 16 }}>
            {busy ? <><span className="rs-spin" aria-hidden="true" />Opening…</> : <>Join board<ArrowIcon /></>}
          </button>
        </div>
      )}
    </form>
  )
}
