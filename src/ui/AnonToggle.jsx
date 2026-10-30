'use client'
import { useDragPanel } from './useDragPanel.js'
import DragGrip from './DragGrip.jsx'
// "Post anonymously" for the next note you add (retro boards). `optional`: a toggle. `always`: a locked notice for
// everyone, the owner included (addsAnonymously sends every note as anonymous). `never`: nothing.
// Either way it floats over the board, so it can be dragged out of the way (see useDragPanel): by its grip, or by pressing the notice itself.
export default function AnonToggle({ mode, on, onChange }) {
  const drag = useDragPanel('retrospace-anon-note')
  if (mode !== 'optional' && mode !== 'always') return null
  const wrap = (children) => (
    <div ref={drag.panel} style={drag.style} {...drag.card} className={`bd-anon-wrap${drag.dragging ? ' is-dragging' : ''}`}>
      <DragGrip grip={drag.grip} dragging={drag.dragging} label="Move this notice" />
      {children}
    </div>
  )
  if (mode === 'always') {
    return wrap(
      <p className="bd-anon bd-anon-locked" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
        <span>Notes on this board are posted anonymously. Nobody sees who wrote them.</span>
      </p>,
    )
  }
  return wrap(
    <button type="button" className={`bd-anon${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)} title="Hide your name from everyone, including the owner">
      {on ? 'Posting anonymously' : 'Post anonymously'}
    </button>,
  )
}
