'use client'
// The owner's view of the summary: the draft (which only the owner is ever sent) and what is happening to it. It is kept
// apart from the board state on purpose: the board that arrives over the stream is the guest-safe one and has no draft.
// While a summary is being written it asks again every 2 seconds, so a summary started by closing the board, or from another
// tab, shows up here by itself.
import { useCallback, useEffect, useRef, useState } from 'react'
import { aiMessage } from '../lib/aiBoard.js'
import { patchBoardRequest } from './ownerApi.js'
import { getSummaryRequest, generateSummaryRequest } from './summaryApi.js'

const POLL_MS = 2000

export function useOwnerSummary(ctl) {
  const { code, syncCid, applyBoard } = ctl
  const [data, setData] = useState({ loaded: false, summary: null, state: 'idle', error: '' })
  const [busy, setBusy] = useState('') // 'generate' | 'save' | 'delete' while one of the owner's own requests is running
  const [problem, setProblem] = useState('')
  const [genFailed, setGenFailed] = useState(false) // the last thing that went wrong was writing a summary: Retry makes sense
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    const r = await getSummaryRequest(code)
    if (!alive.current) return
    if (!r.ok) { setProblem(r.error); setData((d) => ({ ...d, loaded: true })); return }
    const { summary = null, summaryState = 'idle', summaryError } = r.data
    setData({ loaded: true, summary, state: summaryState, error: summaryState === 'failed' ? aiMessage(summaryError) : '' })
  }, [code])

  useEffect(() => { load() }, [load])
  // A change of state announced on the stream (written, failed, started from another tab) is worth a fresh look.
  const announced = ctl.board?.summaryState
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    load()
  }, [announced, load])

  const generating = data.state === 'generating'
  useEffect(() => {
    if (!generating) return undefined
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [generating, load])

  const generate = useCallback(async () => {
    setBusy('generate')
    setProblem('')
    setGenFailed(false)
    setData((d) => ({ ...d, state: 'generating', error: '' }))
    const r = await generateSummaryRequest(code, syncCid())
    if (!alive.current) return false
    setBusy('')
    if (r.ok) {
      setData({ loaded: true, summary: r.data.summary, state: 'idle', error: '' })
      return r.data.summary
    }
    setProblem(r.error)
    setGenFailed(true)
    await load() // the board says what state it is really in (another request may be writing)
    return null
  }, [code, syncCid, load])

  // Saves text and/or status ({ text, status }) or, with null, deletes the summary. -> true when it was saved.
  const save = useCallback(async (edit) => {
    setBusy(edit === null ? 'delete' : 'save')
    setProblem('')
    setGenFailed(false)
    const r = await patchBoardRequest(code, { summary: edit }, syncCid())
    if (!alive.current) return false
    setBusy('')
    if (!r.ok) { setProblem(r.error); return false }
    const board = r.data?.board
    if (board) { applyBoard(board); setData((d) => ({ ...d, loaded: true, summary: board.summary ?? null })) }
    return true
  }, [code, syncCid, applyBoard])

  return { ...data, busy, problem, retryable: genFailed || Boolean(data.error), generating, generate, save, reload: load }
}
