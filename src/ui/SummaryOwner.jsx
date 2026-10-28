'use client'
// The owner's side of the Summary panel: status chips, the editor, and Generate / Write manually / Share / Copy / Delete.
// Text is only ever rendered as text (a textarea), never as HTML or Markdown.
import { useEffect, useId, useRef, useState } from 'react'
import { ConfirmStep } from './settings/controls.jsx'
import CopyButton from './boards/CopyButton.jsx'
import { useOwnerSummary } from './useOwnerSummary.js'
import { MAX_SUMMARY } from '../lib/aiBoard.js'
import { sourceLabel } from './summaryApi.js'

const count = (s) => Array.from(s).length

function Chips({ aiOn, summary }) {
  const chips = [
    { label: aiOn ? 'AI on' : 'AI off', on: aiOn },
    summary ? { label: summary.status === 'shared' ? 'Shared with everyone' : 'Draft (only you can see it)', on: summary.status === 'shared' } : { label: 'No summary yet' },
    summary?.source === 'ai' && { label: sourceLabel(summary), on: true },
  ].filter(Boolean)
  return <ul className="bd-set-chips" aria-label="Summary status">{chips.map((c) => <li key={c.label} className={`bd-set-chip${c.on ? ' is-on' : ''}`}>{c.label}</li>)}</ul>
}

export default function SummaryOwner({ ctl, guardRef, onClose, onOpenSettings }) {
  const sum = useOwnerSummary(ctl)
  const { summary, loaded, busy, problem, generating } = sum
  const id = useId()
  const area = useRef(null)
  const stored = summary?.text ?? ''
  const [text, setText] = useState('')
  const synced = useRef('')
  const [confirm, setConfirm] = useState(null) // 'regenerate' | 'share' | 'delete' | 'close'

  // Whatever the server holds replaces the box, unless the owner has typed something that is not saved yet.
  useEffect(() => {
    const before = synced.current // read now: the updater below runs later, after the ref has moved on
    synced.current = stored
    setText((t) => (t === before ? stored : t))
  }, [stored])

  const dirty = text !== stored
  const length = count(text)
  const tooLong = length > MAX_SUMMARY
  const info = ctl.state.viewer?.ai ?? { configured: false }
  const aiOn = Boolean(ctl.board.ai?.enabled && ctl.board.ai?.ackAt)
  const canGenerate = aiOn && info.configured && !generating && !busy
  const working = Boolean(busy) || generating
  const why = !info.configured ? 'AI summaries are not available on this server. You can still write one yourself.' : !aiOn ? 'AI is off for this board.' : generating ? 'A summary is being written.' : ''

  // Esc, the scrim and Close come through here: with unsaved text the panel asks first (a second Esc backs out of the question).
  useEffect(() => {
    guardRef.current = () => {
      if (!dirty) return false
      setConfirm(confirm === 'close' ? null : 'close')
      return true
    }
  })

  const done = () => setConfirm(null)
  const run = async (fn) => { done(); await fn() }
  const regenerate = () => run(async () => {
    const made = await sum.generate()
    if (made) { synced.current = made.text; setText(made.text) } // the replaced text, unsaved edits included, is gone
  })
  const share = (status) => run(() => sum.save({ ...(dirty && { text }), status }))
  const remove = () => run(async () => { if (await sum.save(null)) setText('') })

  const message = {
    regenerate: `${summary?.status === 'shared'
      ? 'This replaces the shared summary with a new private draft. Everyone stops seeing the current one until you share the new one.'
      : 'This replaces the current summary.'}${dirty ? ' Changes you have not saved are lost too.' : ''}`,
    share: 'Everyone on this board will be able to read this summary.',
    delete: 'This deletes the summary, and guests stop seeing it if it was shared.',
    close: 'You have changes that are not saved.',
  }[confirm]

  return (
    <>
      <Chips aiOn={aiOn} summary={summary} />
      <p className="bd-sum-writing" role="status" aria-live="polite">
        {generating && <><span className="bd-sum-spin" aria-hidden="true" />Writing your summary…</>}
      </p>
      {(problem || sum.error) && (
        <div className="bd-sum-problem" role="alert">
          <p>{problem || sum.error}</p>
          {canGenerate && sum.retryable && <button type="button" className="bd-sbtn" onClick={() => sum.generate()}>Retry</button>}
        </div>
      )}

      <label className="bd-set-label" htmlFor={`${id}-t`}>Summary</label>
      <textarea
        id={`${id}-t`} ref={area} className="bd-sinput bd-sum-area" rows={12} value={text} readOnly={generating || busy === 'save'}
        disabled={!loaded} aria-invalid={tooLong ? 'true' : undefined} aria-describedby={`${id}-c`}
        placeholder={generating ? '' : 'Write a summary of this session, or have AI draft one for you to edit.'}
        onChange={(e) => setText(e.target.value)}
      />
      <p id={`${id}-c`} className={`bd-sum-count${tooLong ? ' is-over' : ''}`}>{length} of {MAX_SUMMARY} characters{tooLong ? ' (too long)' : ''}</p>

      {confirm && (
        <ConfirmStep
          message={message}
          confirmLabel={{ regenerate: 'Replace it', share: 'Share with everyone', delete: 'Delete summary', close: 'Discard changes' }[confirm]}
          cancelLabel={confirm === 'close' ? 'Keep editing' : 'Cancel'}
          tone={confirm === 'share' ? 'primary' : 'danger'}
          onCancel={done}
          onConfirm={{ regenerate, share: () => share('shared'), delete: remove, close: () => { done(); onClose() } }[confirm]}
        />
      )}

      <div className="bd-set-actions">
        <button type="button" className="bd-sbtn is-primary" disabled={!canGenerate} aria-describedby={why ? `${id}-w` : undefined} onClick={() => (summary || dirty ? setConfirm('regenerate') : sum.generate())}>
          {summary ? 'Regenerate' : 'Generate'}
        </button>
        {!summary && !dirty && <button type="button" className="bd-sbtn" disabled={working} onClick={() => area.current?.focus()}>Write manually</button>}
        {dirty && <button type="button" className="bd-sbtn is-primary" disabled={working || tooLong || !text.trim()} onClick={() => sum.save({ text })}>{summary ? 'Save changes' : 'Save as draft'}</button>}
      </div>
      {why && (
        <p id={`${id}-w`} className="bd-set-hint bd-sum-why">
          {why}{' '}
          {info.configured && !aiOn && <button type="button" className="bd-sum-link" onClick={onOpenSettings}>Turn on AI summaries in settings</button>}
        </p>
      )}

      {(summary || text.trim()) && (
        <div className="bd-set-actions">
          {summary?.status === 'shared'
            ? <button type="button" className="bd-sbtn" disabled={working} onClick={() => share('draft')}>Make private</button>
            : <button type="button" className="bd-sbtn" disabled={working || tooLong || !text.trim()} onClick={() => setConfirm('share')}>Share with everyone</button>}
          <CopyButton text={text} label="Copy" ariaLabel="Copy the summary" />
          {summary && <button type="button" className="bd-sbtn is-danger" disabled={working} onClick={() => setConfirm('delete')}>Delete</button>}
        </div>
      )}
      <p className="bd-set-hint">Guests only ever see a summary you share. AI summaries are drafts until you do.</p>
    </>
  )
}
