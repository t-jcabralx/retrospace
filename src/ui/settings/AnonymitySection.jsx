'use client'
import { useId } from 'react'
import { Section, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'

const OPTIONS = [
  ['optional', 'Optional: people choose per note'],
  ['always', 'Always: every participant note is anonymous'],
  ['never', 'Never: notes always show their author'],
]

// Retro boards only. An anonymous note hides its author from everyone, the owner included.
export default function AnonymitySection({ board, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  return (
    <Section title="Anonymous notes">
      <div className="bd-set-item">
        <label className="bd-set-label" htmlFor={id}>Who can post anonymously</label>
        <select id={id} value={board.anonymousNotes ?? 'optional'} disabled={setting.busy} aria-describedby={`${id}-d`} onChange={(e) => setting.save({ anonymousNotes: e.target.value })}>
          {OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <p className="bd-set-desc" id={`${id}-d`}>An anonymous note never shows its author to anyone, you included, and cannot be switched back. Exports show &quot;Anonymous&quot;. Changing this affects new notes only.</p>
        <SaveNote setting={setting} />
      </div>
    </Section>
  )
}
