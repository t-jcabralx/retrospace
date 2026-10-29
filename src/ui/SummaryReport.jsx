'use client'
// The designed view of a summary: a header band, section cards parsed from the plain text, then tables built from the board's
// own items. The AI's text is untrusted and is only ever rendered as React text inside this markup, never as HTML or Markdown.
// variant="paper" is the white, fixed-width, control-free rendering that the PDF / image download draws offscreen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CopyButton, { copyText } from './boards/CopyButton.jsx'
import { sourceLabel } from './summaryApi.js'
import { parseSummary, sectionStyle, isKeySection, votesTable, actionsTable, clipboardTables } from './summaryReport.js'
import './summaryReport.css'

const TITLES = { retro: 'Retrospective summary', celebration: 'Celebration recap' }
const FAIL = "Couldn't create the file. Try again."

function Table({ caption, label, head, rows, numeric = [] }) {
  return (
    <section className="sr-block" aria-label={label}>
      <h3 className="sr-h3">{caption}</h3>
      <div className="sr-scroll" role="region" aria-label={`${label} (scrollable)`} tabIndex={0}>
        <table className="sr-table">
          <caption className="sr-vh">{caption}</caption>
          <thead><tr>{head.map((h, n) => <th key={h} scope="col" className={numeric.includes(n) ? 'is-num' : undefined}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, n) => <tr key={n} data-sr-break>{r.map((c, i) => <td key={i} className={numeric.includes(i) ? 'is-num' : undefined}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}

const Warn = ({ children }) => <span className="sr-chip is-warn"><span aria-hidden="true">⚠ </span>{children}</span>

function Body({ summary, board, model, generatedLabel, variant }) {
  const { parsed, votes, actions } = model
  const title = TITLES[board?.type] ?? 'Board summary'
  return (
    <div className={`sr sr-${variant}`}>
      <header className="sr-head">
        <h2 className="sr-title">{title}</h2>
        <p className="sr-sub">{[board?.title, generatedLabel].filter(Boolean).join(' · ')}</p>
        <span className="sr-chip">{summary?.source === 'ai' ? '✨ ' : ''}{sourceLabel(summary)}</span>
      </header>
      {parsed.preamble.length > 0 && <div className="sr-lead" data-sr-break>{parsed.preamble.map((p, n) => <p key={n}>{p}</p>)}</div>}
      {parsed.sections.length > 0 && (
        <div className="sr-grid">
          {parsed.sections.map((s, n) => {
            const st = sectionStyle(s.title)
            return (
              <section key={n} className={`sr-card is-${st.tone}${isKeySection(s.title) ? ' is-wide' : ''}`} aria-labelledby={`sr-${variant}-${n}`} data-sr-break>
                <h3 id={`sr-${variant}-${n}`} className="sr-card-title"><span aria-hidden="true">{st.icon}</span> {s.title}</h3>
                {s.paragraphs.map((p, i) => <p key={i} className="sr-p">{p}</p>)}
                {s.items.length > 0 && <ul className="sr-list">{s.items.map((it, i) => <li key={i}>{it}</li>)}</ul>}
              </section>
            )
          })}
        </div>
      )}
      {votes.length > 0 && <Table caption="Most voted" label="Most voted items" head={['Rank', 'Item', 'Votes', 'Column']} numeric={[0, 2]} rows={votes.map((v) => [v.tied ? `${v.rank} (tie)` : v.rank, v.text, v.votes, v.category || '-'])} />}
      {actions.length > 0 && (
        <Table caption="Action items" label="Action items" head={['Action', 'Owner', 'Due', 'Status', 'Priority']}
          rows={actions.map((a) => [a.action, a.owner || <Warn>Needs owner</Warn>, a.due || <Warn>Needs due date</Warn>, a.status, a.priority])} />
      )}
    </div>
  )
}

function TableCopy({ tables, onDone }) {
  const [state, setState] = useState('idle')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    let ok = false
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([tables.html], { type: 'text/html' }), 'text/plain': new Blob([tables.text], { type: 'text/plain' }) })])
        ok = true
      }
    } catch { /* fall back to plain text */ }
    if (!ok) ok = await copyText(tables.text)
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2200)
    onDone?.()
  }
  return (
    <>
      <button type="button" className="rs-btn rs-btn--secondary rs-btn--sm sr-btn" onClick={copy}>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy as table'}</button>
      <span className="rs-vh" role="status" aria-live="polite">{state === 'copied' ? 'Table copied to the clipboard' : state === 'failed' ? 'Copying failed.' : ''}</span>
    </>
  )
}

export default function SummaryReport({ summary, board, items, generatedLabel = '', variant = 'panel', showCopy = false }) {
  const text = summary?.text ?? ''
  const model = useMemo(() => ({ parsed: parseSummary(text), votes: votesTable(items), actions: actionsTable(items) }), [text, items])
  const [job, setJob] = useState(null) // 'pdf' | 'png' while a file is being made
  const [note, setNote] = useState('')
  const paper = useRef(null)
  const body = { summary, board, model, generatedLabel }

  useEffect(() => {
    if (!job) return undefined
    let off = false
    ;(async () => {
      try {
        const mod = await import('./summaryExport.js')
        const filename = mod.summaryFilename(board?.title, job)
        await (job === 'pdf' ? mod.exportSummaryPdf : mod.exportSummaryPng)(paper.current, { filename })
        if (!off) setNote('Downloaded')
      } catch {
        if (!off) setNote(FAIL)
      } finally {
        if (!off) setJob(null)
      }
    })()
    return () => { off = true }
  }, [job, board?.title])
  useEffect(() => { if (!note) return undefined; const t = setTimeout(() => setNote(''), 4000); return () => clearTimeout(t) }, [note])

  if (variant === 'paper') return <Body {...body} variant="paper" />
  const tables = clipboardTables({ ...model.parsed, votes: model.votes, actions: model.actions })
  const busy = (k) => job === k
  return (
    <article className="sr-root" aria-label="Summary report">
      <div className="sr-actions">
        {showCopy && <CopyButton text={text} label="Copy" ariaLabel="Copy the summary" />}
        <TableCopy tables={tables} />
        <button type="button" className="rs-btn rs-btn--secondary rs-btn--sm sr-btn" disabled={Boolean(job)} aria-busy={busy('pdf') || undefined} onClick={() => setJob('pdf')}>
          <span aria-hidden="true">⬇ </span>{busy('pdf') ? 'Preparing PDF…' : 'Download PDF'}
        </button>
        <button type="button" className="rs-btn rs-btn--secondary rs-btn--sm sr-btn" disabled={Boolean(job)} aria-busy={busy('png') || undefined} onClick={() => setJob('png')}>
          <span aria-hidden="true">⬇ </span>{busy('png') ? 'Preparing image…' : 'Download image'}
        </button>
        <span className="rs-vh" role="status" aria-live="polite">{note}</span>
      </div>
      <p className="sr-note">The PDF is an image of the report; use Copy for selectable text.{note === FAIL ? ` ${FAIL}` : ''}</p>
      <Body {...body} variant="panel" />
      {job && typeof document !== 'undefined' && createPortal(<div ref={paper} className="sr-offscreen" aria-hidden="true"><Body {...body} variant="paper" /></div>, document.body)}
    </article>
  )
}
