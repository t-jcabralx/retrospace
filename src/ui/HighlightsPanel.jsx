'use client'
// The Highlights panel: a right-hand dialog like Summary. The highlighted notes, the most-voted of the rest and the follow-up
// actions in one list, with a button that copies it as plain text. Built from the same document the print page uses, without
// author names (they are only ever added by the owner's choice on the print page).
import { useId, useMemo, useRef, useState } from 'react'
import { useModal } from './boards/useModal.js'
import { copyText } from './boards/CopyButton.jsx'
import { CloseIcon } from './icons.jsx'
import { buildPrintModel } from '../lib/printModel.js'
import { highlightsText, isHighlighted } from '../lib/highlight.js'
import { suggestHighlightsRequest } from './highlightsApi.js'
import { noteExcerpt } from './themesApi.js'
import './site/site.css'
import './settings.css'
import './summary.css'

const BEHIND = '.bd-top, .bd-board'
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

function Group({ title, note, list, mark }) {
  if (!list.length) return null
  return (
    <section className="bd-hl-group" aria-label={title}>
      <h3>{title}</h3>
      {note && <p className="bd-hl-note">{note}</p>}
      <ul className="bd-hl-list">
        {list.map((r) => (
          <li key={r.id}>
            <span className="bd-hl-mark" aria-hidden="true">{mark}</span>
            <span className="bd-hl-text">{r.text}</span>
            {r.votes > 0 && <span className="bd-hl-votes">{plural(r.votes, 'vote')}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

// The AI part: the owner asks, sees the notes the AI thinks are worth highlighting with its reason, and accepts them one by one or all
// at once. Accepting is the ordinary highlight action; the suggestions are only held here and are gone when the panel closes.
function AiSuggestions({ ctl, code, onOpenSettings }) {
  const [state, setState] = useState({ phase: 'idle', suggestions: [], error: '' })
  const aiOn = Boolean(ctl.board.ai?.enabled && ctl.board.ai?.ackAt)
  const configured = ctl.state.viewer?.ai?.configured !== false
  const byId = useMemo(() => new Map(ctl.items.map((i) => [i.id, i])), [ctl.items])

  async function ask() {
    setState({ phase: 'busy', suggestions: [], error: '' })
    const r = await suggestHighlightsRequest(code)
    setState(r.ok ? { phase: 'done', suggestions: r.suggestions, error: '' } : { phase: 'idle', suggestions: [], error: r.error })
  }
  const open = state.suggestions.filter((s) => byId.has(s.id) && !isHighlighted(byId.get(s.id)))
  const accept = (ids) => ctl.local(ids.map((id) => ({ op: 'highlight', id, on: true })))

  return (
    <section className="bd-hl-group bd-hl-ai" aria-label="AI suggestions">
      <h3>Suggest with AI</h3>
      {!aiOn ? (
        <>
          <p className="bd-hl-note">AI is off for this board. When it is on, the notes&rsquo; text (never names) is sent to the AI provider to pick what stands out.</p>
          {onOpenSettings && <button type="button" className="bd-sbtn" onClick={onOpenSettings}>Open AI settings</button>}
        </>
      ) : !configured ? (
        <p className="bd-hl-note">AI isn&rsquo;t set up on this server.</p>
      ) : (
        <>
          <p className="bd-hl-note">Sends the notes&rsquo; text (never names) to the AI provider, which suggests the ones worth highlighting. You choose what to accept.</p>
          <button type="button" className="bd-sbtn" disabled={state.phase === 'busy'} onClick={ask}>{state.phase === 'busy' ? 'Looking through the notes…' : state.phase === 'done' ? 'Suggest again' : 'Suggest highlights'}</button>
          {state.error && <p className="bd-hl-error" role="alert">{state.error}</p>}
          {state.phase === 'done' && !open.length && <p className="bd-hl-note" role="status">{state.suggestions.length ? 'You have highlighted everything it suggested.' : 'The AI found nothing that stands out yet.'}</p>}
          {open.length > 0 && (
            <>
              <ul className="bd-hl-list">
                {open.map((s) => (
                  <li key={s.id} className="bd-hl-ai-row">
                    <span className="bd-hl-mark" aria-hidden="true">✦</span>
                    <span className="bd-hl-text">{noteExcerpt(byId.get(s.id), 140)}{s.reason && <em className="bd-hl-reason">{s.reason}</em>}</span>
                    <button type="button" className="bd-sbtn" aria-label={`Highlight: ${noteExcerpt(byId.get(s.id), 40)}`} onClick={() => accept([s.id])}>Highlight</button>
                  </li>
                ))}
              </ul>
              {open.length > 1 && <button type="button" className="bd-sbtn" onClick={() => accept(open.map((s) => s.id))}>Highlight all {open.length}</button>}
            </>
          )}
        </>
      )}
    </section>
  )
}

export default function HighlightsPanel({ ctl, code, onClose, openerRef, printHref, onOpenSettings }) {
  const root = useRef(null)
  const titleId = useId()
  const [copied, setCopied] = useState(null)
  useModal(root, onClose, openerRef, { inert: BEHIND })
  const model = useMemo(() => buildPrintModel(ctl.board, ctl.items, [], { authors: false }), [ctl.board, ctl.items])
  const h = model.highlights

  async function copy() {
    setCopied(await copyText(highlightsText(model.cover.title, h)))
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <>
      <div className="bd-settings-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={root} className="bd-settings bd-sum" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="bd-settings-head">
          <h2 id={titleId}>Highlights</h2>
          <button type="button" className="bd-iconbtn bd-settings-close" aria-label="Close highlights" onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="bd-settings-body">
          {h ? (
            <>
              <Group title="Highlighted" list={h.highlighted} mark="★" />
              <Group title="Most voted" note="The notes with the most votes that are not highlighted." list={h.top} mark="•" />
              <Group title="Action items" list={h.actions} mark="☐" />
              <div className="bd-set-actions">
                <button type="button" className="bd-sbtn" data-autofocus onClick={copy}>{copied === true ? 'Copied' : copied === false ? 'Copy failed' : 'Copy as text'}</button>
                {printHref && <a className="bd-sbtn" href={printHref} target="_blank" rel="noopener">Open the printable version</a>}
              </div>
            </>
          ) : (
            <p className="bd-sum-empty" role="status">Nothing is highlighted yet. Select a note and press the star (or H) to highlight it. Notes with votes and action items show up here too.</p>
          )}
          <AiSuggestions ctl={ctl} code={code} onOpenSettings={onOpenSettings} />
        </div>
      </aside>
    </>
  )
}
