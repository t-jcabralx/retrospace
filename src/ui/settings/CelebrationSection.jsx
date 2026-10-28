'use client'
// Celebration boards only: who the board is for, when the recipient may see the cards, and the two links to send out.
import { useEffect, useId, useState } from 'react'
import { Section, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'
import CopyButton from '../boards/CopyButton.jsx'
import { LinkIcon } from '../site/icons.jsx'
import { MAX_RECIPIENT } from '../../lib/validate.js'
import { toLocalInput, fromLocalInput, describeReveal, zoneLabel } from '../revealTime.js'
import { boardLink, revealLink } from '../share.js'

function Recipient({ board, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  const saved = board.recipient?.name ?? ''
  const [value, setValue] = useState(saved)
  const [problem, setProblem] = useState('')
  useEffect(() => { setValue(saved) }, [saved])

  async function commit() {
    const next = value.trim()
    if (!next) { setProblem('Enter the name of the person this board is for.'); return }
    if (next.length > MAX_RECIPIENT) { setProblem(`At most ${MAX_RECIPIENT} characters (now ${next.length}).`); return }
    setProblem('')
    if (next === saved) { setValue(next); return }
    if (await setting.save({ recipient: { name: next } })) setValue(next)
  }

  return (
    <div className="bd-set-item">
      <label className="bd-set-label" htmlFor={id}>Recipient name</label>
      <input
        id={id}
        className="bd-sinput"
        type="text"
        value={value}
        maxLength={MAX_RECIPIENT + 20}
        disabled={setting.busy}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={`${id}-d ${id}-e`}
        onChange={(e) => { setValue(e.target.value); setProblem('') }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      />
      <p id={`${id}-d`} className="bd-set-desc">Shown on the recipient&apos;s welcome screen.</p>
      <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
      <SaveNote setting={setting} />
    </div>
  )
}

function RevealTime({ ctl, board, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  const saved = toLocalInput(board.revealAt)
  const [value, setValue] = useState(saved)
  const [problem, setProblem] = useState('')
  useEffect(() => { setValue(saved) }, [saved])
  const iso = fromLocalInput(value)
  const dirty = value !== saved

  async function save() {
    if (!value) { setProblem('Pick a date and time, or use Clear.'); return }
    if (!iso) { setProblem('That date and time is not valid.'); return }
    setProblem('')
    await setting.save({ revealAt: iso })
  }

  return (
    <div className="bd-set-item">
      <label className="bd-set-label" htmlFor={id}>Reveal time</label>
      <input
        id={id}
        className="bd-sinput"
        type="datetime-local"
        value={value}
        disabled={setting.busy}
        aria-invalid={problem ? 'true' : undefined}
        aria-describedby={`${id}-d ${id}-z ${id}-e`}
        onChange={(e) => { setValue(e.target.value); setProblem('') }}
      />
      <p id={`${id}-z`} className="bd-set-desc">Your time zone: {zoneLabel()}</p>
      <p id={`${id}-d`} className="bd-set-desc" role="status">{describeReveal(board.revealAt, ctl.clock.now())}</p>
      <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
      <div className="bd-set-actions">
        <button type="button" className="bd-sbtn is-primary" disabled={setting.busy || !dirty} onClick={save}>Save time</button>
        <button type="button" className="bd-sbtn" disabled={setting.busy || !board.revealAt} onClick={() => { setProblem(''); setting.save({ revealAt: null }) }}>Clear</button>
        <button type="button" className="bd-sbtn" disabled={setting.busy} onClick={() => { setProblem(''); setting.save({ revealAt: new Date(ctl.clock.now()).toISOString() }) }}>Reveal now</button>
      </div>
      <SaveNote setting={setting} />
    </div>
  )
}

export default function CelebrationSection({ ctl, board, patchBoard }) {
  const origin = window.location.origin
  return (
    <Section title="Celebration">
      <Recipient board={board} patchBoard={patchBoard} />
      <RevealTime ctl={ctl} board={board} patchBoard={patchBoard} />
      <div className="bd-set-item">
        <p className="bd-set-desc">Send contributors the first link and keep the second for the recipient.</p>
        <div className="bd-set-copyrow">
          <CopyButton text={boardLink(origin, board.code)} label="Copy contributor link" ariaLabel="Copy contributor link" Icon={LinkIcon} />
          <CopyButton text={revealLink(origin, board.code)} label="Copy recipient link" ariaLabel="Copy recipient link" Icon={LinkIcon} />
        </div>
      </div>
    </Section>
  )
}
