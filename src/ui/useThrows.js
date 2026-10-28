'use client'
// Arming and sending thrown emoji for one viewer. Armed emoji -> next click on a note (or the canvas) throws it: the
// animation plays here at once and { t: 'throw', emoji, itemId?, x, y } (world coordinates) goes to the room. The
// tray only exists while throwing is on, the viewer can write and the stream is live. Your own throttle matches the
// server's budget; the server stays the authority.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createThrowLimiter } from './throwMotion.js'
import { isSingleEmoji } from '../lib/emoji.js'

const NOTICE_MS = 2500
// What the server says when it refuses a throw for the board's rules (any other 403, such as an expired token, is retried by sync).
const REFUSALS = new Set(['Throwing is off', 'Board is read-only', 'That emoji is not on the list', 'This link was revoked'])
const TAKE_BACK_MS = 600 // a refusal this soon after the throw also stops its animation

export function useThrows({ ctl, layerRef }) {
  const cfg = ctl.board?.throwables
  const emojis = useMemo(() => (cfg?.enabled && Array.isArray(cfg.emojis) ? cfg.emojis.filter(isSingleEmoji) : []), [cfg])
  const canThrow = emojis.length > 0 && !ctl.readOnly && ctl.status === 'live' && Boolean(ctl.persona)
  const [armed, setArmed] = useState(null)
  const [notice, setNotice] = useState('')
  const limiter = useRef(createThrowLimiter())
  const noticeTimer = useRef(null)
  const latest = useRef(null)
  latest.current = { ctl, armed, canThrow }

  useEffect(() => () => clearTimeout(noticeTimer.current), [])
  // Switched off, removed from the list, or the viewer can no longer write: disarm.
  useEffect(() => { if (armed && (!canThrow || !emojis.includes(armed))) setArmed(null) }, [armed, canThrow, emojis])

  const say = (text) => {
    setNotice(text)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), NOTICE_MS)
  }

  // `at` = { x, y } in world coordinates, `itemId` optional. -> whether it was thrown.
  const throwAt = useCallback((at, itemId, { keep = false } = {}) => {
    const { ctl: c, armed: emoji, canThrow: ok } = latest.current
    if (!emoji || !ok) return false
    if (!limiter.current.tryThrow()) { say(`Slow down — try again in ${Math.ceil(limiter.current.waitMs() / 1000)} s`); return false }
    const sentAt = Date.now()
    const flight = layerRef.current?.play({ emoji, itemId, x: at.x, y: at.y, name: c.persona?.name, avatar: c.persona?.avatar }, { announce: false })
    c.sendEphemeral({ t: 'throw', emoji, ...(itemId && { itemId }), x: at.x, y: at.y }, (status, error) => {
      if (!(status === 429 || (status === 403 && REFUSALS.has(error)))) return
      c.notify(status === 429 ? 'Slow down' : error) // the server is the authority: tell the thrower
      if (flight && Date.now() - sentAt < TAKE_BACK_MS) layerRef.current?.cancel(flight)
    })
    if (!keep) setArmed(null)
    return true
  }, [layerRef])

  const arm = useCallback((emoji) => { setNotice(''); setArmed((a) => (a === emoji ? null : emoji)) }, [])
  const disarm = useCallback(() => setArmed(null), [])
  return { emojis, canThrow, armed, notice, arm, disarm, throwAt }
}
