'use client'
// Review and discuss: the most-voted topics with their votes, a status for each and the notes taken. Everyone sees it;
// only the owner changes it. A tie at the cut-off lists every tied topic so the owner picks which to discuss.
import { useId, useMemo, useState } from 'react'
import { rankTopics, topicOf, TOPIC_STATUSES } from '../lib/retro.js'
import { jumpTo } from './useRetroJump.js'

const STATUS_LABEL = { not: 'Not yet', discussed: 'Discussed', deferred: 'Deferred', action: 'Needs action' }

function Topic({ row, retro, isOwner, run, busy, picked, onPick }) {
  const id = useId()
  const t = topicOf(retro, row.id)
  const [note, setNote] = useState('')
  return (
    <li className={`rt-topic${row.selected ? '' : ' is-unpicked'}`}>
      <button type="button" className="rt-topic-text" onClick={() => jumpTo(row.id)} title="Show on the board">{row.text || '(empty)'}</button>
      <span className="rt-chip">{row.votes} {row.votes === 1 ? 'vote' : 'votes'}</span>
      {row.tied && <span className="rt-chip is-warn">Tied</span>}
      {isOwner && row.tied && (
        <label className="rt-pick"><input type="checkbox" checked={picked} onChange={onPick} /> Discuss this</label>
      )}
      {row.selected && (
        <>
          <div className="rt-status" role="group" aria-label={`Status of ${row.text}`}>
            {TOPIC_STATUSES.map((s) => (
              isOwner
                ? <button key={s} type="button" className="rt-chip rt-chip-btn" aria-pressed={t.status === s} disabled={busy} onClick={() => run({ type: 'topic', itemId: row.id, status: s })}>{STATUS_LABEL[s]}</button>
                : t.status === s && <span key={s} className="rt-chip is-on">{STATUS_LABEL[s]}</span>
            ))}
          </div>
          {t.notes.length > 0 && <ul className="rt-notes">{t.notes.map((n, i) => <li key={i}>{n.text}</li>)}</ul>}
          {isOwner && (
            <form className="rt-note-form" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && (await run({ type: 'topic', itemId: row.id, note }))) setNote('') }}>
              <label htmlFor={id} className="bd-vh">Add a discussion note</label>
              <input id={id} className="bd-sinput" maxLength={300} placeholder="Add a discussion note" value={note} onChange={(e) => setNote(e.target.value)} />
              <button type="submit" className="bd-sbtn" disabled={busy || !note.trim()}>Add</button>
            </form>
          )}
        </>
      )}
    </li>
  )
}

export default function DiscussPanel({ ctl, rt }) {
  const { retro, run, busy } = rt
  const [picked, setPicked] = useState([])
  const rows = useMemo(() => rankTopics(ctl.items, retro.topN, picked), [ctl.items, retro.topN, picked])
  if (!rows.length) return <p className="rt-hint">No votes yet, so there is nothing to rank. Go back to Vote, or pick topics from the board.</p>
  const tied = rows.some((r) => r.tied)
  return (
    <div>
      {tied && <p className="rt-hint">Several topics are tied for the last place. {ctl.isOwner ? 'Choose which ones to discuss.' : 'The facilitator will choose.'}</p>}
      <ol className="rt-topics">
        {rows.map((r) => (
          <Topic key={r.id} row={r} retro={retro} isOwner={ctl.isOwner} run={run} busy={busy} picked={picked.includes(r.id)}
            onPick={() => setPicked((p) => (p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id]))} />
        ))}
      </ol>
    </div>
  )
}
