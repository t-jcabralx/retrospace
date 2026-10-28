'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Section, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'
import { MAX_TITLE } from '../../lib/validate.js'

// The title: saved when you leave the field or press Enter, never while you are still typing.
export default function GeneralSection({ board, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  const [value, setValue] = useState(board.title)
  const [problem, setProblem] = useState('')
  const inflight = useRef(false) // Enter then the blur it causes must not send the title twice
  useEffect(() => { setValue(board.title) }, [board.title])

  // Esc or a click on the scrim closes the drawer without a blur: a valid pending edit is saved, an invalid one is dropped
  // (the title simply stays as it was).
  const pending = useRef(null)
  pending.current = { next: value.trim(), title: board.title, patchBoard }
  useEffect(() => () => {
    const { next, title, patchBoard: patch } = pending.current
    if (next && next.length <= MAX_TITLE && next !== title && !inflight.current) patch({ title: next })
  }, [])

  async function commit() {
    const next = value.trim()
    if (!next) { setProblem('The title cannot be empty.'); return }
    if (next.length > MAX_TITLE) { setProblem(`At most ${MAX_TITLE} characters (now ${next.length}).`); return }
    setProblem('')
    if (next === board.title) { setValue(next); return }
    if (inflight.current) return
    inflight.current = true
    try { if (await setting.save({ title: next })) setValue(next) } finally { inflight.current = false }
  }

  return (
    <Section title="General">
      <label className="bd-set-label" htmlFor={id}>Board title</label>
      <input
        id={id}
        className="bd-sinput"
        type="text"
        value={value}
        maxLength={MAX_TITLE + 20}
        disabled={setting.busy}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={`${id}-e`}
        onChange={(e) => { setValue(e.target.value); setProblem('') }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
      <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
      <SaveNote setting={setting} />
    </Section>
  )
}
