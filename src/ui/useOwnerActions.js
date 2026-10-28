'use client'
// The owner's write calls, bound to one open board: change settings (PATCH) and start a new vote round. The server's
// answer updates this tab at once; every other tab and guest hears about it over the stream.
import { useCallback } from 'react'
import { patchBoardRequest, resetVotesRequest } from './ownerApi.js'

export function useOwnerActions(ctl) {
  const { code, syncCid, applyBoard, votesCleared } = ctl

  // -> { ok: true } or { ok: false, status, error }
  const patchBoard = useCallback(async (patch) => {
    const r = await patchBoardRequest(code, patch, syncCid())
    if (!r.ok) return r
    if (r.data?.board) applyBoard(r.data.board)
    return { ok: true }
  }, [code, syncCid, applyBoard])

  const resetVotes = useCallback(async () => {
    const r = await resetVotesRequest(code, syncCid())
    if (!r.ok) return r
    votesCleared()
    return { ok: true, cleared: r.data?.cleared ?? 0 }
  }, [code, syncCid, votesCleared])

  return { patchBoard, resetVotes }
}
