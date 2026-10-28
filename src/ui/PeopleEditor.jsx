'use client'
// Team wall settings (owner): the people list behind @mentions, birthdays and work anniversaries. Name is required; the
// birthday is MM-DD (no year) or empty; the start date is a date or empty. Saved with the owner-only people route, which
// checks every field again. Guests never receive birthdays or start dates (they get names only, see /people-names).
import { useId, useState } from 'react'
import { Section } from './settings/controls.jsx'
import { freshId } from '../client/state.js'
import { MAX_PEOPLE, MAX_TO_NAME, toRows, rowProblem, rowsToPayload } from '../lib/wall.js'
import './wall.css'

async function savePeople(code, people) {
  try {
    const res = await fetch(`/api/boards/${code}/people`, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ people }) })
    const data = await res.json().catch(() => ({}))
    return res.ok ? { ok: true } : { ok: false, error: data?.error ? data.error[0].toUpperCase() + data.error.slice(1) : `Something went wrong (${res.status})` }
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' }
  }
}

export default function PeopleEditor({ ctl }) {
  const id = useId()
  const [rows, setRows] = useState(() => toRows(ctl.state?.people))
  const [tried, setTried] = useState(false)
  const [phase, setPhase] = useState({ s: 'idle' }) // idle | saving | saved | error

  const set = (rid, patch) => { setRows((l) => l.map((r) => (r.id === rid ? { ...r, ...patch } : r))); setPhase({ s: 'idle' }) }
  const problems = rows.map(rowProblem)

  async function save() {
    setTried(true)
    if (problems.some(Boolean)) { setPhase({ s: 'error', error: 'Fix the highlighted people first.' }); return }
    setPhase({ s: 'saving' })
    const r = await savePeople(ctl.code, rowsToPayload(rows))
    setPhase(r.ok ? { s: 'saved' } : { s: 'error', error: r.error })
  }

  return (
    <Section title="People" hint="Names appear when someone types in a shout-out. Birthdays and start dates are only used to show today’s birthdays and work anniversaries; only you can see them.">
      <ul className="wl-people">
        {rows.map((r, i) => (
          <li key={r.id} className="wl-person">
            <input className="cs-input" type="text" maxLength={MAX_TO_NAME} autoComplete="off" value={r.name} aria-label={`Name of person ${i + 1}`} aria-invalid={tried && problems[i] ? 'true' : undefined} onChange={(e) => set(r.id, { name: e.target.value })} />
            <input className="cs-input" type="text" inputMode="numeric" placeholder="MM-DD" maxLength={5} autoComplete="off" value={r.birthday} aria-label={`Birthday of ${r.name || `person ${i + 1}`}, month and day as MM-DD`} aria-invalid={tried && problems[i] ? 'true' : undefined} onChange={(e) => set(r.id, { birthday: e.target.value })} />
            <input className="cs-input" type="date" value={r.startDate} aria-label={`Start date of ${r.name || `person ${i + 1}`}`} aria-invalid={tried && problems[i] ? 'true' : undefined} onChange={(e) => set(r.id, { startDate: e.target.value })} />
            <button type="button" className="cs-btn cs-btn--icon" aria-label={`Remove ${r.name || `person ${i + 1}`}`} onClick={() => { setRows((l) => l.filter((x) => x.id !== r.id)); setPhase({ s: 'idle' }) }}><span aria-hidden="true">×</span></button>
            {tried && problems[i] && <p className="cs-error" role="alert">{problems[i]}</p>}
          </li>
        ))}
      </ul>
      <div className="bd-set-actions">
        <button type="button" className="bd-sbtn" disabled={rows.length >= MAX_PEOPLE} onClick={() => { setRows((l) => [...l, { id: freshId(), name: '', birthday: '', startDate: '' }]); setPhase({ s: 'idle' }) }}>Add a person</button>
        <button type="button" className="bd-sbtn is-primary" disabled={phase.s === 'saving'} onClick={save}>Save people</button>
      </div>
      <p id={`${id}-n`} className="bd-set-note" role={phase.s === 'error' ? 'alert' : 'status'} aria-live="polite">
        {phase.s === 'saving' ? 'Saving…' : phase.s === 'saved' ? 'Saved' : phase.s === 'error' ? phase.error : ''}
      </p>
    </Section>
  )
}
