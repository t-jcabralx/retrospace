'use client'
// The owner's lists: people (outer ring), prizes (inner ring), helpers and the one rule. Edits stay in a draft until Save,
// so a half-typed list never reaches the wheel; the draft follows the server again as soon as it is saved or unchanged.
import { useEffect, useMemo, useRef, useState } from 'react'
import { LIMITS } from '../../lib/wheel.js'

let tmp = 0
const tmpId = () => `t${Date.now().toString(36)}${(tmp++).toString(36)}`
const NAMES = /[\n\r,;\t]+/
const snapshot = (w) => JSON.stringify([w.participants, w.prizes, w.helpers, w.rules.removeWinners])

export default function Setup({ api }) {
  const { wheel, owner, joined } = api
  const locked = wheel.round.state !== 'idle'
  const server = useMemo(() => snapshot(wheel), [wheel])
  const [people, setPeople] = useState(wheel.participants)
  const [prizes, setPrizes] = useState(wheel.prizes)
  const [helpers, setHelpers] = useState(wheel.helpers)
  const [removeWinners, setRemove] = useState(wheel.rules.removeWinners)
  const base = useRef(server)
  const dirty = snapshot({ participants: people, prizes, helpers, rules: { removeWinners } }) !== base.current
  const [paste, setPaste] = useState('')
  const [prize, setPrize] = useState({ name: '', emoji: '', qty: 1 })
  const [state, setState] = useState({ phase: 'idle', error: '' })

  useEffect(() => { // someone else (or an accepted draw) changed the wheel and there is nothing unsaved here: follow it
    if (snapshot({ participants: people, prizes, helpers, rules: { removeWinners } }) === base.current) {
      setPeople(wheel.participants); setPrizes(wheel.prizes); setHelpers(wheel.helpers); setRemove(wheel.rules.removeWinners)
      base.current = server
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server])

  const won = useMemo(() => new Map(wheel.history.map((h) => [h.winner.id, h.prize])), [wheel.history])
  if (!owner) return <p className="ev-empty">Only the host sets up the wheel.</p>

  function addNames(text) {
    const have = new Set(people.map((p) => p.name.toLowerCase()))
    const fresh = []
    for (const raw of text.split(NAMES)) {
      const name = raw.replace(/\s+/g, ' ').trim()
      if (name && !have.has(name.toLowerCase())) { have.add(name.toLowerCase()); fresh.push({ id: tmpId(), name, on: true }) }
    }
    if (!fresh.length) return setState({ phase: 'idle', error: text.trim() ? 'Those names are already on the wheel.' : '' })
    setState({ phase: 'idle', error: '' })
    setPeople([...people, ...fresh].slice(0, LIMITS.participants))
  }
  function addJoined() {
    const have = new Set(people.map((p) => p.uid).filter(Boolean))
    const names = new Set(people.map((p) => p.name.toLowerCase()))
    const fresh = joined.filter((j) => !have.has(j.uid) && !names.has(j.name.toLowerCase())).map((j) => ({ id: tmpId(), name: j.name, on: true, uid: j.uid }))
    setPeople([...people, ...fresh].slice(0, LIMITS.participants))
    setState({ phase: 'idle', error: fresh.length ? '' : 'Everyone who joined is already on the wheel.' })
  }
  function addPrize(e) {
    e.preventDefault()
    const name = prize.name.trim()
    if (!name) return setState({ phase: 'idle', error: 'Give the prize a name.' })
    const qty = Math.min(LIMITS.qty, Math.max(1, Math.floor(Number(prize.qty) || 1)))
    setPrizes([...prizes, { id: tmpId(), name, emoji: prize.emoji.trim(), qty, color: '' }].slice(0, LIMITS.prizes))
    setPrize({ name: '', emoji: '', qty: 1 })
    setState({ phase: 'idle', error: '' })
  }
  async function save() {
    setState({ phase: 'saving', error: '' })
    const r = await api.saveSetup({ participants: people, prizes, helpers, rules: { removeWinners } })
    if (r.ok) { base.current = snapshot({ participants: people, prizes, helpers, rules: { removeWinners } }); setState({ phase: 'saved', error: '' }) } else setState({ phase: 'idle', error: r.error })
  }

  const on = people.filter((p) => p.on && !p.won).length
  const canJoin = joined.filter((j) => !j.mine)
  return (
    <section className="ev-setup" aria-label="Set up the wheel">
      {locked && <p className="ev-note" role="status">A draw is in progress. Finish or go back from it before changing the lists.</p>}
      <fieldset disabled={locked} className="ev-fs">
        <h3>People <span className="ev-count">{on} on the wheel</span></h3>
        <label className="ev-label" htmlFor="ev-paste">Add names</label>
        <textarea id="ev-paste" className="ev-input" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Maria\nJohn, Priya'} />
        <div className="ev-row">
          <button type="button" className="ev-btn" onClick={() => { addNames(paste); setPaste('') }}>Add to the wheel</button>
          {canJoin.length > 0 && <button type="button" className="ev-btn ev-btn--quiet" onClick={addJoined}>Add everyone who joined ({canJoin.length})</button>}
        </div>
        {people.length > 0 && (
          <ul className="ev-list">
            {people.map((p) => (
              <li key={p.id} className={p.won ? 'is-won' : ''}>
                <label><input type="checkbox" checked={p.on && !p.won} disabled={p.won} onChange={(e) => setPeople(people.map((q) => (q.id === p.id ? { ...q, on: e.target.checked } : q)))} /> <span>{p.name}</span></label>
                {won.has(p.id) && p.won && <span className="ev-tag">won {won.get(p.id).emoji} {won.get(p.id).name}</span>}
                <button type="button" className="ev-x" aria-label={`Remove ${p.name}`} onClick={() => setPeople(people.filter((q) => q.id !== p.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset disabled={locked} className="ev-fs">
        <h3>Prizes <span className="ev-count">{prizes.filter((z) => z.qty > 0).length} on the wheel</span></h3>
        <form className="ev-prizeform" onSubmit={addPrize}>
          <input className="ev-input ev-emoji" aria-label="Emoji (optional)" placeholder="🎁" maxLength={8} value={prize.emoji} onChange={(e) => setPrize({ ...prize, emoji: e.target.value })} />
          <input className="ev-input ev-grow" aria-label="Prize name" placeholder="Gift card" maxLength={60} value={prize.name} onChange={(e) => setPrize({ ...prize, name: e.target.value })} />
          <input className="ev-input ev-qty" type="number" min="1" max={LIMITS.qty} aria-label="How many" value={prize.qty} onChange={(e) => setPrize({ ...prize, qty: e.target.value })} />
          <button className="ev-btn" type="submit">Add</button>
        </form>
        {prizes.length > 0 && (
          <ul className="ev-list">
            {prizes.map((z) => (
              <li key={z.id} className={z.qty === 0 ? 'is-won' : ''}>
                <span className="ev-swatch" style={{ background: z.color || '#7f77dd' }} aria-hidden="true" />
                <span className="ev-grow">{z.emoji} {z.name}</span>
                <span className="ev-stepper">
                  <button type="button" aria-label={`One fewer ${z.name}`} onClick={() => setPrizes(prizes.map((q) => (q.id === z.id ? { ...q, qty: Math.max(0, q.qty - 1) } : q)))}>−</button>
                  <output aria-label={`${z.qty} left`}>{z.qty}</output>
                  <button type="button" aria-label={`One more ${z.name}`} onClick={() => setPrizes(prizes.map((q) => (q.id === z.id ? { ...q, qty: Math.min(LIMITS.qty, q.qty + 1) } : q)))}>+</button>
                </span>
                <button type="button" className="ev-x" aria-label={`Remove ${z.name}`} onClick={() => setPrizes(prizes.filter((q) => q.id !== z.id))}>×</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset disabled={locked} className="ev-fs">
        <h3>Rules</h3>
        <label className="ev-switch"><input type="checkbox" checked={removeWinners} onChange={(e) => setRemove(e.target.checked)} /> Take a winner off the wheel after you accept them</label>
        {canJoin.length > 0 && (
          <>
            <h3>Helpers <span className="ev-count">can run the draw too</span></h3>
            <ul className="ev-list">
              {canJoin.map((j) => (
                <li key={j.uid}><label><input type="checkbox" checked={helpers.includes(j.uid)} onChange={(e) => setHelpers(e.target.checked ? [...helpers, j.uid].slice(0, LIMITS.helpers) : helpers.filter((h) => h !== j.uid))} /> <span>{j.name}</span></label></li>
              ))}
            </ul>
          </>
        )}
      </fieldset>

      <div className="ev-savebar">
        <button type="button" className="ev-btn ev-btn--primary" disabled={locked || !dirty || state.phase === 'saving'} onClick={save}>{state.phase === 'saving' ? 'Saving…' : 'Save changes'}</button>
        <span className="ev-saved" role="status">{state.phase === 'saved' && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : ''}</span>
      </div>
      {state.error && <p className="ev-error" role="alert">{state.error}</p>}
    </section>
  )
}
