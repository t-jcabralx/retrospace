'use client'
import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from '../site/icons.jsx'

// A password input with an accessible show/hide toggle. Forwards the usual input props.
export default function PasswordField({ inputRef, toggleLabel = 'Show password', ...props }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="rs-input-wrap">
      <input ref={inputRef} className="rs-input" type={shown ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} {...props} />
      <button type="button" className="rs-input-btn" aria-label={toggleLabel} aria-pressed={shown} onClick={() => setShown((v) => !v)}>
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}
