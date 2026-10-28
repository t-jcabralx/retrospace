'use client'
import { useEffect, useMemo, useState } from 'react'
import { Section, ConfirmStep } from './controls.jsx'
import Avatar from '../Avatar.jsx'
import { removeParticipantRequest, listParticipantsRequest } from '../ownerToolsApi.js'
import '../owner-tools.css'

const KIND = { account: 'Owner', custom: 'Chose a name', anonymous: 'Anonymous' }

// Everyone on the board with how much they added, and a Remove button (with a confirm step and an "also delete their
// notes" choice). The list comes from the live participants data, so people who join or are removed appear at once.
export default function PeopleSection({ ctl }) {
  const { code, uid: me, items, state, participantRemoved } = ctl
  const [asking, setAsking] = useState(null) // uid being confirmed
  const [alsoItems, setAlsoItems] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ kind: '', text: '' })
  const counts = useMemo(() => {
    const m = new Map()
    for (const it of items ?? []) if (!it.deleted && it.authorUid) m.set(it.authorUid, (m.get(it.authorUid) ?? 0) + 1)
    return m
  }, [items])
  const [fresh, setFresh] = useState(null) // the server's current list; the snapshot's is the starting point
  const people = (fresh ?? state?.participants ?? []).filter((p) => p.uid !== me)

  // Keeps the list live while the drawer is open: people who joined since the board loaded appear, removed ones disappear.
  useEffect(() => {
    let dead = false
    const load = async () => {
      if (document.hidden) return
      const r = await listParticipantsRequest(code)
      if (!dead && r.ok) setFresh(r.participants)
    }
    load()
    const t = setInterval(load, 10_000)
    return () => { dead = true; clearInterval(t) }
  }, [code])

  async function confirm(p) {
    setBusy(true)
    const r = await removeParticipantRequest(code, p.uid, { deleteItems: alsoItems })
    setBusy(false)
    if (!r.ok) { setMsg({ kind: 'error', text: r.error }); return }
    participantRemoved(p.uid, Array.isArray(r.data?.changed) ? r.data.changed : [])
    setFresh((list) => (list ? list.filter((x) => x.uid !== p.uid) : list))
    setAsking(null)
    setAlsoItems(false)
    setMsg({ kind: 'ok', text: `${p.name} was removed${r.data?.itemsDeleted ? ` and ${r.data.itemsDeleted} of their notes were deleted` : ''}.` })
  }

  return (
    <Section title="People" hint="Removing someone blocks this browser from the board. They can come back only with a new browser identity, so pair removal with a passcode change or by revoking the link.">
      {people.length === 0 && <p className="bd-set-desc">Nobody else has joined yet.</p>}
      <ul className="bd-people">
        {people.map((p) => (
          <li key={p.uid} className="bd-people-row">
            <Avatar avatar={p.avatar} name={p.name} size={30} decorative />
            <span className="bd-people-text">
              <span className="bd-people-name">{p.name}</span>
              <span className="bd-people-meta">{KIND[p.kind] ?? p.kind} · {counts.get(p.uid) ?? 0} {(counts.get(p.uid) ?? 0) === 1 ? 'note' : 'notes'}</span>
            </span>
            {p.kind !== 'account' && asking !== p.uid && (
              <button type="button" className="bd-sbtn is-danger" aria-label={`Remove ${p.name}`} onClick={() => { setAsking(p.uid); setAlsoItems(false); setMsg({ kind: '', text: '' }) }}>Remove</button>
            )}
            {asking === p.uid && (
              <div className="bd-people-confirm">
                <label className="bd-people-check"><input type="checkbox" checked={alsoItems} onChange={(e) => setAlsoItems(e.target.checked)} disabled={busy} /> Also delete their notes</label>
                <ConfirmStep message={`Remove ${p.name} from the board?`} confirmLabel="Remove" busy={busy} onConfirm={() => confirm(p)} onCancel={() => setAsking(null)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="bd-set-note" role="status" aria-live="polite">{msg.kind === 'ok' ? msg.text : ''}</p>
      <p className="bd-set-note is-error" role="alert">{msg.kind === 'error' ? msg.text : ''}</p>
    </Section>
  )
}
