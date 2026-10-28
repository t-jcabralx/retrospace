'use client'
import { useId, useState } from 'react'
import PasswordField from '../auth/PasswordField.jsx'
import { SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'

const MIN = 4
const MAX = 64

// Set, change or remove the board passcode. The server keeps only a hash and never sends it back, so the field is always
// empty and the only thing shown is whether a passcode is on.
export default function PasscodeSetting({ on, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [problem, setProblem] = useState('')
  const showField = editing || !on

  async function save() {
    if (value.length < MIN || value.length > MAX) { setProblem(`The passcode must be ${MIN} to ${MAX} characters.`); return }
    setProblem('')
    if (await setting.save({ passcode: value })) { setValue(''); setEditing(false) }
  }
  async function remove() {
    if (await setting.save({ passcode: null })) { setValue(''); setEditing(false); setProblem('') }
  }

  return (
    <div className="bd-set-item">
      <p className="bd-set-label" id={`${id}-t`}>Passcode</p>
      <p className="bd-set-desc">{on ? 'Passcode is on. Guests must enter it before they can open the board. It is never shown here.' : 'Ask guests for a passcode before they can open the board.'}</p>
      {on && (
        <div className="bd-set-actions">
          <span className="bd-chipnote"><span aria-hidden="true">●</span> Passcode is on</span>
          <button type="button" className="bd-sbtn" aria-expanded={editing} onClick={() => { setEditing((e) => !e); setProblem('') }} disabled={setting.busy}>{editing ? 'Cancel change' : 'Change passcode'}</button>
          <button type="button" className="bd-sbtn" onClick={remove} disabled={setting.busy}>Remove passcode</button>
        </div>
      )}
      {showField && (
        <form className="bd-set-passform" onSubmit={(e) => { e.preventDefault(); save() }} noValidate>
          <label className="bd-set-label" htmlFor={`${id}-p`}>{on ? 'New passcode' : 'Choose a passcode'}</label>
          <PasswordField
            id={`${id}-p`}
            name="board-passcode"
            autoComplete="new-password"
            toggleLabel="Show passcode"
            value={value}
            maxLength={MAX + 10}
            disabled={setting.busy}
            aria-invalid={problem ? 'true' : undefined}
            aria-describedby={`${id}-e ${id}-h`}
            onChange={(e) => { setValue(e.target.value); setProblem('') }}
          />
          <p id={`${id}-h`} className="bd-set-hint">{MIN} to {MAX} characters. Share it separately from the link.</p>
          <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
          <div className="bd-set-actions">
            <button type="submit" className="bd-sbtn is-primary" disabled={setting.busy || !value}>{on ? 'Save new passcode' : 'Set passcode'}</button>
          </div>
        </form>
      )}
      <SaveNote setting={setting} />
    </div>
  )
}
