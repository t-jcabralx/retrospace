'use client'
import { useId } from 'react'

// "Post anonymously" for a card or a shout-out (their forms). `optional`: a checkbox. `always`: a locked notice, as for notes
// (the form sends every post as anonymous). `never`: nothing. The server decides what the board's mode allows.
export default function AnonCheck({ mode, on, onChange }) {
  const id = useId()
  if (mode === 'always') {
    return (
      <p className="bd-anon-note" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
        <span>Everything on this board is posted anonymously. Nobody sees who wrote it.</span>
      </p>
    )
  }
  if (mode !== 'optional') return null
  return (
    <div className="bd-set-item bd-anon-check">
      <label htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(on)} onChange={(e) => onChange(e.target.checked)} />
        <span><b>Post anonymously</b><small>Your name is hidden from everyone, including the owner. This cannot be undone.</small></span>
      </label>
    </div>
  )
}
