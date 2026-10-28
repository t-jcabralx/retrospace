'use client'
// "Post anonymously" for the next note you add (retro boards). `optional`: a toggle. `always`: a locked notice for
// everyone, the owner included (addsAnonymously sends every note as anonymous). `never`: nothing.
export default function AnonToggle({ mode, on, onChange }) {
  if (mode !== 'optional' && mode !== 'always') return null
  if (mode === 'always') {
    return (
      <p className="bd-anon bd-anon-locked" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
        <span>Notes on this board are posted anonymously. Nobody sees who wrote them.</span>
      </p>
    )
  }
  return (
    <button type="button" className={`bd-anon${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)} title="Hide your name from everyone, including the owner">
      {on ? 'Posting anonymously' : 'Post anonymously'}
    </button>
  )
}
