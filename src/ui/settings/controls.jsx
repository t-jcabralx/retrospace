'use client'
// Small building blocks of the settings panel: a titled section, a labelled switch, the per-control save note and the
// inline confirmation step.
import { useEffect, useId, useRef } from 'react'

export function Section({ title, hint, children }) {
  const id = useId()
  return (
    <section className="bd-set-section" aria-labelledby={id}>
      <h3 id={id} className="bd-set-h">{title}</h3>
      {hint && <p className="bd-set-hint">{hint}</p>}
      {children}
    </section>
  )
}

// What happened to the last change: a polite "Saving…" / "Saved", and an alert when it failed. Always rendered, so the
// live region exists before its text changes.
export function SaveNote({ setting }) {
  const { phase, error } = setting
  return (
    <p className={`bd-set-note is-${phase}`}>
      <span role="status" aria-live="polite">{phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved' : ''}</span>
      <span role="alert">{phase === 'error' ? error : ''}</span>
    </p>
  )
}

export function Switch({ label, desc, checked, onChange, disabled, children, id: given }) {
  const own = useId()
  const id = given ?? own
  return (
    <div className="bd-set-item">
      <div className="bd-set-row">
        <div className="bd-set-text">
          <span id={`${id}-l`} className="bd-set-label">{label}</span>
          <span id={`${id}-d`} className="bd-set-desc">{desc}</span>
        </div>
        <button
          type="button"
          id={`${id}-b`}
          role="switch"
          className="bd-switch"
          aria-checked={checked}
          aria-labelledby={`${id}-l`}
          aria-describedby={`${id}-d`}
          disabled={disabled}
          onClick={() => onChange(!checked)}
        >
          <span className="bd-switch-knob" aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  )
}

// "Are you sure?" shown in place, with the safe choice focused first (`tone="primary"` for a step that is not destructive). Esc backs out of just this step.
export function ConfirmStep({ message, confirmLabel, onConfirm, onCancel, busy = false, cancelLabel = 'Cancel', tone = 'danger' }) {
  const cancel = useRef(null)
  useEffect(() => { cancel.current?.focus() }, [])
  return (
    <div
      className={`bd-set-confirm${tone === 'danger' ? '' : ' is-info'}`}
      role="group"
      aria-label="Confirm"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Next hydrates the whole document, so the modal's own Esc listener sits on the same node: stop it too.
        e.preventDefault()
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        onCancel()
      }}
    >
      <p>{message}</p>
      <div className="bd-set-actions">
        <button ref={cancel} type="button" className="bd-sbtn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={`bd-sbtn ${tone === 'danger' ? 'is-danger' : 'is-primary'}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </div>
  )
}
