'use client'
import { useId } from 'react'
import { Section, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'

const OPTIONS = [
  ['optional', 'Optional: people choose each time'],
  ['always', 'Always: every participant post is anonymous'],
  ['never', 'Never: posts always show their author'],
]

// Every board where people post (not the prize wheel). An anonymous note, card or shout-out hides its author from everyone, the owner included.
export default function AnonymitySection({ board, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  return (
    <Section title="Anonymous posts">
      <div className="bd-set-item">
        <label className="bd-set-label" htmlFor={id}>Who can post anonymously</label>
        <select id={id} value={board.anonymousNotes ?? 'optional'} disabled={setting.busy} aria-describedby={`${id}-d`} onChange={(e) => setting.save({ anonymousNotes: e.target.value })}>
          {OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <p className="bd-set-desc" id={`${id}-d`}>An anonymous note, card or shout-out never shows its author to anyone, you included, and cannot be switched back. A card is signed &quot;Anonymous&quot;, and exports show &quot;Anonymous&quot;. Changing this affects new posts only.</p>
        <SaveNote setting={setting} />
      </div>
    </Section>
  )
}
