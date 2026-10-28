'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginHref } from '../../lib/nav.js'
import { getJson } from '../site/api.js'
import { useAuth, setSignedOut, refreshAuth } from '../site/useAuth.js'
import { PlusIcon } from '../site/icons.jsx'
import BoardCard from './BoardCard.jsx'
import NewBoardDialog from './NewBoardDialog.jsx'
import './boards.css'

const SKELETONS = [0, 1, 2]
const minute = (t) => Math.floor(t / 60_000) * 60_000 // cards are memoised: their time only changes when the minute does


export default function Dashboard() {
  const router = useRouter()
  const auth = useAuth()
  const [load, setLoad] = useState({ phase: 'loading', boards: [] }) // loading | ready | error
  const [creating, setCreating] = useState(false)
  const openerRef = useRef(null)
  const [now, setNow] = useState(() => minute(Date.now()))

  const fetchBoards = useCallback(async () => {
    setLoad((l) => ({ ...l, phase: 'loading' }))
    const r = await getJson('/api/my-boards')
    if (r.status === 401) { setSignedOut(); return }
    setLoad(r.ok ? { phase: 'ready', boards: r.data.boards ?? [] } : { phase: 'error', boards: [] })
    setNow(minute(Date.now()))
  }, [])

  useEffect(() => {
    if (auth.status === 'out') router.replace(loginHref('/boards'))
    else if (auth.status === 'in') fetchBoards()
  }, [auth.status, router, fetchBoards])

  useEffect(() => {
    const t = setInterval(() => setNow(minute(Date.now())), 30_000) // keeps "3 min ago" honest
    return () => clearInterval(t)
  }, [])

  const closeDialog = useCallback(() => setCreating(false), [])
  const openDialog = (e) => { openerRef.current = e.currentTarget; setCreating(true) }
  const ready = auth.status === 'in' && load.phase === 'ready'
  const loading = auth.status === 'loading' || auth.status === 'out' || (auth.status === 'in' && load.phase === 'loading')
  const failed = auth.status === 'error' || (auth.status === 'in' && load.phase === 'error')

  return (
    <div className="rs-wrap db-wrap">
      <div className="db-head">
        <div>
          <h1>Your boards</h1>
          <p className="db-sub">{ready && load.boards.length > 0 ? `${load.boards.length} ${load.boards.length === 1 ? 'board' : 'boards'}. Share a board’s access code to let people join.` : 'Create a board and share its access code to let people join.'}</p>
        </div>
        <button type="button" className="rs-btn rs-btn--primary rs-btn--lg" onClick={openDialog} disabled={loading}>
          <PlusIcon />New board
        </button>
      </div>

      {loading && (
        <ul className="db-grid" aria-busy="true" aria-label="Loading your boards">
          {SKELETONS.map((i) => <li key={i} className="rs-card db-skel" aria-hidden="true"><i /><i /><i /></li>)}
        </ul>
      )}

      {failed && (
        <div className="rs-card db-empty" role="alert">
          <h2>Couldn&apos;t load your boards</h2>
          <p>Something went wrong reaching the server.</p>
          <button type="button" className="rs-btn rs-btn--primary" onClick={() => (auth.status === 'error' ? refreshAuth() : fetchBoards())}>Try again</button>
        </div>
      )}

      {ready && load.boards.length === 0 && (
        <div className="rs-card db-empty">
          <h2>No boards yet</h2>
          <p>Create your first board, then share its access code so your team can join.</p>
          <button type="button" className="rs-btn rs-btn--primary rs-btn--lg" onClick={openDialog}><PlusIcon />New board</button>
        </div>
      )}

      {ready && load.boards.length > 0 && (
        <ul className="db-grid">
          {load.boards.map((b) => <li key={b.code}><BoardCard board={b} now={now} /></li>)}
        </ul>
      )}

      {creating && <NewBoardDialog onClose={closeDialog} openerRef={openerRef} />}
    </div>
  )
}
