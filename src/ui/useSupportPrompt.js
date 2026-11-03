'use client'
// Opens the support pop-up once when the board reaches its end (see lib/supportPrompt.js). It is marked as seen the moment it
// opens, so a reload does not bring it back; "don't show this again" stops it for every board in this browser.
import { useCallback, useEffect, useState } from 'react'
import { promptReason, shouldShow, markSeen, optOut, SHOW_DELAY_MS } from '../lib/supportPrompt.js'

export function useSupportPrompt(board, code, ready) {
  const [open, setOpen] = useState(false)
  const reason = ready ? promptReason(board) : null

  useEffect(() => {
    if (!reason || open) return undefined
    if (!shouldShow({ board, code })) return undefined
    const t = setTimeout(() => { markSeen(code); setOpen(true) }, SHOW_DELAY_MS)
    return () => clearTimeout(t)
  }, [reason, board, code, open])

  const close = useCallback(() => setOpen(false), [])
  const never = useCallback(() => { optOut(); setOpen(false) }, [])
  return { open, close, never }
}
