'use client'
// Three steps: type, template, details. Types come from BOARD_TYPES, so adding Retro later is one entry there.
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { BOARD_TYPES, typeInfo, templateList, defaultTitle, checkBoardDetails } from '../../lib/boardTypes.js'
import { waitText } from '../../lib/code.js'
import { loginHref } from '../../lib/nav.js'
import { postJson } from '../site/api.js'
import { typeIcon, CloseIcon, ArrowIcon } from '../site/icons.jsx'
import { useModal, focusInitial } from './useModal.js'
import { getTemplate } from '../../lib/templates.js'
import { rowProblems, stripKeys } from '../../lib/columnsEdit.js'
import { DEFAULT_HEADER } from '../../lib/columns.js'
import ColumnsEditor from '../ColumnsEditor.jsx'

const STEP_TITLES = { type: 'Choose a board type', template: 'Pick a template', columns: 'Set up the columns', details: 'Name your board' }

function createMessage(r) {
  if (r.status === 429) return `Too many tries — ${waitText(r.retryAfter)}`
  if (r.status === 503) return 'We couldn’t set up a board code just now. Please try again.'
  if (r.status === 0) return 'Couldn’t reach the server. Check your connection and try again.'
  if (r.status === 400 && r.data?.error) return r.data.error[0].toUpperCase() + r.data.error.slice(1)
  return 'Something went wrong. Please try again.'
}

export default function NewBoardDialog({ onClose, openerRef }) {
  const router = useRouter()
  const root = useRef(null)
  const id = useId()
  const [step, setStep] = useState(0)
  const [type, setType] = useState(BOARD_TYPES[0].key)
  const [template, setTemplate] = useState(() => templateList(BOARD_TYPES[0].key)[0].key)
  const [title, setTitle] = useState(null) // null until the person edits it, so the suggestion follows the template and recipient
  const [recipient, setRecipient] = useState('')
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState(false)
  const [cols, setCols] = useState(null) // { rows, header } once the person edits the columns; null = the template's own
  const [colErrors, setColErrors] = useState(false)
  const [votes, setVotes] = useState('3') // retro only: votes per person

  const [focusField, setFocusField] = useState(null) // { id, n }: focus a field once its error has been rendered
  // Esc, the backdrop and Close all wait while the board is being created.
  useModal(root, () => { if (!busy) onClose() }, openerRef)
  useEffect(() => { focusInitial(root.current) }, [step]) // the first move is made by useModal too; every step change lands on that step's first control
  useEffect(() => { if (focusField) root.current?.querySelector(`#${CSS.escape(focusField.id)}`)?.focus() }, [focusField])

  const info = typeInfo(type)
  const templates = templateList(type)
  const hasCols = Boolean(getTemplate(type, template)?.columns) // retro and the workshop templates with columns get a Columns step
  const steps = hasCols ? ['type', 'template', 'columns', 'details'] : ['type', 'template', 'details']
  const stepName = steps[step]
  const shownTitle = title ?? defaultTitle(type, template, info.needsRecipient ? recipient : '')

  function pickType(key) {
    setType(key)
    setCols(null)
    setTemplate(templateList(key)[0].key)
    setErrors({})
  }

  async function create(e) {
    e.preventDefault()
    if (busy) return
    const found = checkBoardDetails(type, { title: shownTitle, recipient })
    setErrors(found)
    if (found.title || found.recipient) {
      setFocusField((f) => ({ id: found.recipient ? `${id}-recipient` : `${id}-title`, n: (f?.n ?? 0) + 1 }))
      return
    }
    setBusy(true)
    setFailure('')
    const body = { type, template, title: shownTitle, ...(info.needsRecipient ? { recipient: { name: recipient.trim() } } : {}), ...(type === 'retro' && Number.isInteger(Number(votes)) && Number(votes) >= 1 && Number(votes) <= 20 ? { votes: Number(votes) } : {}), ...(hasCols && cols ? { columns: stripKeys(cols.rows), ...(type === 'retro' && cols.header !== undefined && cols.header !== DEFAULT_HEADER ? { header: cols.header } : {}) } : {}) }
    const r = await postJson('/api/boards', body)
    if (r.ok && r.data?.code) { router.push(`/b/${r.data.code}`); return } // stay busy until the board opens
    if (r.status === 401) { router.push(loginHref('/boards')); return }
    setFailure(createMessage(r))
    setBusy(false)
  }

  function next(e) {
    e.preventDefault()
    if (stepName === 'columns' && cols && rowProblems(cols.rows)) {
      setColErrors(true)
      setTimeout(() => root.current?.querySelector('.cs-editor [aria-invalid="true"]')?.focus(), 0)
      return
    }
    setStep((s) => s + 1)
  }

  return createPortal(
    <div className="db-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div ref={root} className="rs-card db-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-h`} tabIndex={-1}>
        <header className="db-dialog-head">
          <div>
            <p className="db-step">New board · Step {step + 1} of {steps.length}</p>
            <h2 id={`${id}-h`}>{STEP_TITLES[stepName]}</h2>
          </div>
          <button type="button" className="rs-input-btn db-close" aria-label="Close" onClick={() => { if (!busy) onClose() }} disabled={busy}><CloseIcon /></button>
        </header>

        {stepName === 'type' && (
          <form onSubmit={next}>
            <fieldset className="db-fieldset">
              <legend className="rs-vh">Board type</legend>
              <div className="db-choices">
                {BOARD_TYPES.map((t) => {
                  const Icon = typeIcon(t.key)
                  return (
                    <label key={t.key} className="db-choice">
                      <input type="radio" name={`${id}-type`} value={t.key} checked={type === t.key} onChange={() => pickType(t.key)} data-autofocus={type === t.key ? '' : undefined} />
                      <span className="db-choice-icon"><Icon /></span>
                      <span className="db-choice-text"><strong>{t.label}</strong><span>{t.blurb}</span></span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <div className="db-actions">
              <button type="button" className="rs-btn rs-btn--secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="rs-btn rs-btn--primary">Next<ArrowIcon /></button>
            </div>
          </form>
        )}

        {stepName === 'template' && (
          <form onSubmit={next}>
            <fieldset className="db-fieldset">
              <legend className="rs-vh">{info.label} template</legend>
              <div className="db-templates">
                {templates.map((t) => (
                  <label key={t.key} className="db-tpl">
                    <input type="radio" name={`${id}-tpl`} value={t.key} checked={template === t.key} onChange={() => { setTemplate(t.key); setCols(null) }} data-autofocus={template === t.key ? '' : undefined} />
                    <span className="db-tpl-emoji" aria-hidden="true">{t.emoji}</span>
                    <span className="db-tpl-name">{t.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="db-actions">
              <button type="button" className="rs-btn rs-btn--secondary" onClick={() => setStep(0)}>Back</button>
              <button type="submit" className="rs-btn rs-btn--primary">Next<ArrowIcon /></button>
            </div>
          </form>
        )}

        {stepName === 'columns' && (
          <form onSubmit={next} noValidate>
            <ColumnsEditor type={type} templateKey={template} value={cols} onChange={(v) => { setCols(v); setColErrors(false) }} showErrors={colErrors} />
            <div className="db-actions">
              <button type="button" className="rs-btn rs-btn--secondary" onClick={() => setStep(1)}>Back</button>
              <button type="submit" className="rs-btn rs-btn--primary">Next<ArrowIcon /></button>
            </div>
          </form>
        )}

        {stepName === 'details' && (
          <form onSubmit={create} noValidate>
            <div aria-live="assertive" aria-atomic="true" className="rs-live">{failure && <div className="rs-alert">{failure}</div>}</div>
            {info.needsRecipient && (
              <div className="rs-field">
                <label className="rs-label" htmlFor={`${id}-recipient`}>Recipient name</label>
                <input
                  id={`${id}-recipient`} className="rs-input" type="text" autoComplete="off" value={recipient} data-autofocus=""
                  onChange={(e) => { setRecipient(e.target.value); setFailure(''); setErrors((x) => ({ ...x, recipient: undefined })) }}
                  aria-invalid={errors.recipient ? 'true' : undefined} aria-describedby={`${id}-recipient-hint ${id}-recipient-error`}
                />
                <p className="rs-hint" id={`${id}-recipient-hint`}>Who the celebration is for. It appears in the board&apos;s headline.</p>
                <p className="rs-error" id={`${id}-recipient-error`}>{errors.recipient ?? ''}</p>
              </div>
            )}
            <div className="rs-field">
              <label className="rs-label" htmlFor={`${id}-title`}>Title</label>
              <input
                id={`${id}-title`} className="rs-input" type="text" autoComplete="off" value={shownTitle} data-autofocus={info.needsRecipient ? undefined : ''}
                onChange={(e) => { setTitle(e.target.value); setFailure(''); setErrors((x) => ({ ...x, title: undefined })) }}
                aria-invalid={errors.title ? 'true' : undefined} aria-describedby={`${id}-title-error`}
              />
              <p className="rs-error" id={`${id}-title-error`}>{errors.title ?? ''}</p>
            </div>
            {type === 'retro' && (
              <div className="rs-field">
                <label className="rs-label" htmlFor={`${id}-votes`}>Votes per person</label>
                <input id={`${id}-votes`} className="rs-input" type="number" inputMode="numeric" min="1" max="20" step="1" value={votes} onChange={(e) => setVotes(e.target.value)} aria-describedby={`${id}-votes-hint`} />
                <p className="rs-hint" id={`${id}-votes-hint`}>How many votes everyone gets when voting opens (1 to 20). You can change it later in Settings.</p>
              </div>
            )}
            <div className="db-actions">
              <button type="button" className="rs-btn rs-btn--secondary" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>
              <button type="submit" className="rs-btn rs-btn--primary" disabled={busy}>
                {busy ? <><span className="rs-spin" aria-hidden="true" />Creating…</> : 'Create board'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}
