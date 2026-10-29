'use client'
// Create an action (or edit one): what, owner, due date, how we will know, priority. Sends a normal item op, so the
// server's stage rules and limits apply; the form shows what the board would refuse before sending.
import { useId, useState } from 'react'
import { addOp, topZ } from './ops.js'
import { isRealDay, ACTION_STATUSES, ACTION_PRIORITIES } from '../lib/validate.js'

const EMPTY = { action: '', owner: '', due: '', measure: '', status: 'open', priority: 'normal', notes: '' }

export function nextActionSpot(items) {
  const n = items.filter((i) => i.kind === 'action').length // below the columns, four to a row
  return { x: (n % 4) * 300, y: 820 + Math.floor(n / 4) * 230, w: 280, h: 200 }
}

export default function ActionComposer({ ctl, initial = null, onDone, atLimit = false }) {
  const id = useId()
  const [f, setF] = useState({ ...EMPTY, ...(initial?.data ?? {}) })
  const [problem, setProblem] = useState('')
  const set = (k) => (e) => { setF((s) => ({ ...s, [k]: e.target.value })); setProblem('') }

  function submit(e) {
    e.preventDefault()
    const action = f.action.trim()
    if (!action) return setProblem('Say what the action is.')
    if (action.length > 200) return setProblem('An action can be up to 200 characters.')
    if (f.due && !isRealDay(f.due)) return setProblem('Pick a real due date.')
    if (!initial && atLimit) return setProblem('The action limit is reached.')
    const data = { ...f, action }
    const ok = initial
      ? ctl.local([{ op: 'update', id: initial.id, patch: { data } }])
      : ctl.local([addOp('action', nextActionSpot(ctl.items), data, topZ(ctl.items) + 1)])
    if (!ok) return setProblem('The board could not take this change.')
    if (!initial) setF({ ...EMPTY })
    onDone?.()
  }

  return (
    <form className="rt-form" onSubmit={submit} aria-label={initial ? 'Edit action' : 'New action'}>
      <label htmlFor={`${id}a`} className="rt-label">What will we do?</label>
      <textarea id={`${id}a`} className="bd-sinput" rows={2} maxLength={200} placeholder="e.g. Add a retry to the deploy script" value={f.action} onChange={set('action')} />
      <div className="rt-row">
        <div>
          <label htmlFor={`${id}o`} className="rt-label">Owner</label>
          <input id={`${id}o`} className="bd-sinput" maxLength={60} placeholder="Who will do it?" value={f.owner} onChange={set('owner')} />
        </div>
        <div>
          <label htmlFor={`${id}d`} className="rt-label">Due date</label>
          <input id={`${id}d`} className="bd-sinput" type="date" value={f.due} onChange={set('due')} />
        </div>
      </div>
      <label htmlFor={`${id}m`} className="rt-label">How will we know it worked?</label>
      <input id={`${id}m`} className="bd-sinput" maxLength={200} placeholder="e.g. No failed deploys for two weeks" value={f.measure} onChange={set('measure')} />
      <div className="rt-row">
        <div>
          <label htmlFor={`${id}p`} className="rt-label">Priority</label>
          <select id={`${id}p`} className="bd-sinput" value={f.priority} onChange={set('priority')}>{ACTION_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        </div>
        {initial && (
          <div>
            <label htmlFor={`${id}s`} className="rt-label">Status</label>
            <select id={`${id}s`} className="bd-sinput" value={f.status} onChange={set('status')}>{ACTION_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </div>
        )}
      </div>
      <p className="bd-set-error" role="alert">{problem}</p>
      <div className="bd-set-actions">
        <button type="submit" className="bd-sbtn is-primary">{initial ? 'Save action' : 'Add action'}</button>
        {initial && <button type="button" className="bd-sbtn" onClick={onDone}>Cancel</button>}
      </div>
    </form>
  )
}
