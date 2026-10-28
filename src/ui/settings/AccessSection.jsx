'use client'
import { useId, useState } from 'react'
import { Section, Switch, SaveNote, ConfirmStep } from './controls.jsx'
import { useSetting } from './useSetting.js'
import PasscodeSetting from './PasscodeSetting.jsx'

// One switch backed by one setting. Turning on a drastic one (close, revoke) asks first; turning it off never does.
function Toggle({ patchBoard, label, desc, checked, field, ask }) {
  const setting = useSetting(patchBoard)
  const [asking, setAsking] = useState(false)
  const id = useId()
  const apply = async (next) => {
    setAsking(false)
    await setting.save(typeof field === 'function' ? field(next) : { [field]: next })
    setTimeout(() => document.getElementById(`${id}-b`)?.focus(), 0) // a confirm step took focus with it when it closed
  }
  return (
    <Switch
      id={id}
      label={label}
      desc={desc}
      checked={checked}
      disabled={setting.busy}
      onChange={(next) => (next && ask ? (setting.clear(), setAsking(true)) : apply(next))}
    >
      {asking && <ConfirmStep message={ask} confirmLabel={`Yes, ${label.toLowerCase()}`} onConfirm={() => apply(true)} onCancel={() => { setAsking(false); setTimeout(() => document.getElementById(`${id}-b`)?.focus(), 0) }} />}
      <SaveNote setting={setting} />
    </Switch>
  )
}

export default function AccessSection({ board, patchBoard }) {
  return (
    <Section title="Access">
      <Toggle
        patchBoard={patchBoard}
        label="Lock board"
        desc="Guests can look but not add or change anything. You can still edit."
        checked={Boolean(board.locked)}
        field="locked"
      />
      <Toggle
        patchBoard={patchBoard}
        label="Close board"
        desc="Guests can only read the board and a closed badge shows. Reopen it any time."
        checked={board.status === 'closed'}
        field={(on) => ({ status: on ? 'closed' : 'open' })}
        ask="Close this board? Guests will only be able to read it."
      />
      <Toggle
        patchBoard={patchBoard}
        label="Revoke link"
        desc="Blocks every guest, including people already on the board. Turn it off to let them back in."
        checked={Boolean(board.revoked)}
        field="revoked"
        ask="Revoke the link? Everyone except you is shut out straight away."
      />
      <PasscodeSetting on={Boolean(board.hasPasscode)} patchBoard={patchBoard} />
    </Section>
  )
}
