'use client'
// The print / Save-as-PDF page. The board is fetched once from the board API (one consistent snapshot, with the same access
// rules and the same guest-safe fields as the board itself), then drawn as a document by buildPrintModel. It is rendered in the
// browser, so without JavaScript only a notice shows. The browser's own print dialog makes the PDF (no server PDF library).
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { buildPrintModel, printPhase } from '../lib/printModel.js'
import './print.css'

const MESSAGES = {
  missing: ['Board not found', 'There is no board with this code.'],
  passcode: ['This board needs its passcode', 'Open the board, enter the passcode, then come back to print it.'],
  revoked: ['This link was revoked', 'The owner turned off access to this board.'],
  removed: ['You were removed from this board', 'It can no longer be opened from this browser.'],
  error: ['Could not load the board', 'Something went wrong reaching the server. Try again.'],
}

const fmt = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '')
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Item({ item, showVotes }) {
  const votes = showVotes && item.votes > 0 ? <span className="pv-votes">{plural(item.votes, 'vote')}</span> : null
  if (item.kind === 'card') {
    return (
      <li className="pv-card">
        <p className="pv-text">{item.text}</p>
        <p className="pv-sig">— {item.signer}</p>
        {item.media && <img className="pv-media" src={item.media.src} alt="" />}
        {item.author && <p className="pv-author">Added by {item.author}</p>}
        {votes}
      </li>
    )
  }
  if (item.kind === 'shoutout') {
    return (
      <li className="pv-item">
        <p className="pv-text"><strong>To {item.to}:</strong> {item.text}</p>
        {item.author && <p className="pv-author">From {item.author}</p>}
        {votes}
      </li>
    )
  }
  return (
    <li className="pv-item">
      <p className="pv-text">{item.text}</p>
      {item.author && <p className="pv-author">{item.author}</p>}
      {votes}
    </li>
  )
}

export function PrintDocument({ model }) {
  const { cover, sections, themes, summary, showVotes } = model
  const meta = [cover.type, cover.created && fmt(cover.created), plural(cover.participants, 'participant')].filter(Boolean).join(' · ')
  return (
    <article className="pv-doc">
      <header className="pv-cover">
        <h1>{cover.title}</h1>
        <p className="pv-meta">{meta}</p>
        {cover.printed && <p className="pv-meta">Printed {fmt(cover.printed)}</p>}
      </header>
      {summary && (
        <section className="pv-section" aria-labelledby="pv-summary">
          <h2 id="pv-summary">Summary</h2>
          {summary.ai && <p className="pv-meta">AI-generated, reviewed by the owner</p>}
          <p className="pv-summary">{summary.text}</p>
        </section>
      )}
      {themes.length > 0 && (
        <section className="pv-section" aria-labelledby="pv-themes">
          <h2 id="pv-themes">Themes</h2>
          <ul className="pv-list">
            {themes.map((t) => (
              <li key={t.id} className="pv-item pv-theme">
                <p className="pv-text"><strong>{t.title}</strong> <span className="pv-meta">{plural(t.notes.length, 'note')}</span></p>
                {showVotes && t.votes > 0 && <span className="pv-votes">{plural(t.votes, 'vote')}</span>}
                <ul className="pv-sub">{t.notes.map((n) => <li key={n.id}>{n.text}</li>)}</ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sections.map((s) => (
        <section key={s.title} className="pv-section" aria-label={s.title}>
          <h2>{s.title}</h2>
          <ul className={s.title === 'Cards' ? 'pv-cards' : 'pv-list'}>{s.items.map((i) => <Item key={i.id} item={i} showVotes={showVotes} />)}</ul>
        </section>
      ))}
      {model.empty && <p className="pv-meta">There is nothing on this board yet.</p>}
    </article>
  )
}

export default function PrintView({ code }) {
  const [state, setState] = useState({ phase: 'loading' })
  const [authors, setAuthors] = useState(false)

  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const res = await fetch(`/api/boards/${encodeURIComponent(code)}`, { cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        const phase = printPhase(res.status, body?.error)
        if (!dead) setState(phase === 'ready' ? { phase, snapshot: body, at: Date.now() } : { phase })
      } catch {
        if (!dead) setState({ phase: 'error' })
      }
    })()
    return () => { dead = true }
  }, [code])

  const snap = state.snapshot
  const isOwner = snap?.viewer?.role === 'owner'
  const model = useMemo(
    () => (snap ? buildPrintModel(snap.board, snap.items, snap.participants, { authors, isOwner, now: state.at }) : null),
    [snap, authors, isOwner, state.at],
  )

  return (
    <div className="pv-page">
      <noscript><p className="pv-notice">This page needs JavaScript to draw the board for printing.</p></noscript>
      <div className="pv-bar">
        <Link className="pv-btn" href={`/b/${encodeURIComponent(code)}`}>Back to the board</Link>
        {model && (
          <>
            <button type="button" className="pv-btn is-primary" onClick={() => window.print()}>Print / Save as PDF</button>
            {isOwner && (
              <label className="pv-check">
                <input type="checkbox" checked={authors} onChange={(e) => setAuthors(e.target.checked)} />
                Include author names
              </label>
            )}
          </>
        )}
      </div>
      {state.phase === 'loading' && <p className="pv-notice" role="status">Loading the board…</p>}
      {MESSAGES[state.phase] && (
        <div className="pv-notice" role="alert"><h1>{MESSAGES[state.phase][0]}</h1><p>{MESSAGES[state.phase][1]}</p></div>
      )}
      {model && <PrintDocument model={model} />}
    </div>
  )
}
