'use client'
// "Delete my account": hidden until asked for, says plainly what goes, and needs the password and the word DELETE.
import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteJson } from '../site/api.js'
import { setSignedOut } from '../site/useAuth.js'

export default function DeleteAccount() {
  const id = useId()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [word, setWord] = useState('')
  const [state, setState] = useState({ busy: false, error: '' })

  async function submit(e) {
    e.preventDefault()
    if (word.trim() !== 'DELETE') return setState({ busy: false, error: 'Type DELETE in capital letters to confirm.' })
    if (!password) return setState({ busy: false, error: 'Enter your password.' })
    setState({ busy: true, error: '' })
    const r = await deleteJson('/api/auth/account', { password })
    if (r.ok) { setSignedOut(); router.replace('/'); return }
    setState({ busy: false, error: r.status === 403 ? 'That password is not right.' : r.status === 429 ? 'Too many tries. Wait a while and try again.' : 'Something went wrong. Try again.' })
  }

  return (
    <details className="db-danger">
      <summary>Delete my account</summary>
      <form onSubmit={submit} className="db-danger-form">
        <p>This permanently deletes your account, every board you own (with all its notes, people, raffle lists and history), your saved templates and your sign-ins. It cannot be undone. Other people&apos;s boards are not affected.</p>
        <label htmlFor={`${id}-p`}>Your password</label>
        <input id={`${id}-p`} className="rs-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor={`${id}-w`}>Type <strong>DELETE</strong> to confirm</label>
        <input id={`${id}-w`} className="rs-input" type="text" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
        {state.error && <p className="db-danger-error" role="alert">{state.error}</p>}
        <button type="submit" className="rs-btn db-danger-btn" disabled={state.busy}>{state.busy ? 'Deleting…' : 'Delete everything'}</button>
      </form>
    </details>
  )
}
