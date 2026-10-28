'use client'
// The staged retro workflow as the UI uses it: the current stage and one `run(action)` that sends it to the server
// (owner only; the server applies the state machine in lib/retro.js and answers with the new board).
import { useCallback, useState } from 'react'
import { useOwnerActions } from './useOwnerActions.js'
import { enabledStages, currentStage, isStarted } from '../lib/retro.js'

export function useRetro(ctl) {
  const { patchBoard } = useOwnerActions(ctl)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const retro = ctl.board?.retro
  const run = useCallback(async (action) => {
    setBusy(true)
    const r = await patchBoard({ retro: action })
    setBusy(false)
    setError(r.ok ? '' : r.error || 'Could not change the stage')
    return r.ok
  }, [patchBoard])
  const list = retro ? enabledStages(retro) : []
  return { retro, run, busy, error, clearError: () => setError(''), list, stage: retro ? currentStage(retro) : null, step: retro ? Math.min(Math.max(retro.current, 0), list.length - 1) : 0, started: retro ? isStarted(retro) : false }
}
