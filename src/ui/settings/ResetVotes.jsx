'use client'
// "Reset votes" with its inline confirmation and save note, shared by the settings drawer and the vote panel.
// `resetVotes` is the owner's call (-> { ok, error? }); `onDone` runs after a successful reset.
import { useId, useState } from 'react'
import { ConfirmStep, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'

export default function ResetVotes({ resetVotes, onDone, className = 'bd-sbtn' }) {
  const id = useId()
  const reset = useSetting(async () => resetVotes())
  const [asking, setAsking] = useState(false)
  // The confirm step takes focus with it when it closes: put it back on the button.
  const refocus = () => setTimeout(() => document.getElementById(`${id}-r`)?.focus(), 0)
  return (
    <>
      {asking ? (
        <ConfirmStep
          message="Clear all votes on this board? This cannot be undone."
          confirmLabel="Yes, reset votes"
          busy={reset.busy}
          onConfirm={async () => {
            const ok = await reset.save({})
            setAsking(false)
            if (ok) onDone?.()
            else refocus()
          }}
          onCancel={() => { setAsking(false); refocus() }}
        />
      ) : (
        <button id={`${id}-r`} type="button" className={className} disabled={reset.busy} onClick={() => { reset.clear(); setAsking(true) }}>Reset votes</button>
      )}
      <SaveNote setting={reset} />
    </>
  )
}
