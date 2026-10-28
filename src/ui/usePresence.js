'use client'
// Wires a presence client (presenceClient.js) to one open board: creates it for this viewer, feeds it the stream's
// ephemeral messages, maps the stream's state to its link mode (live / paused / off), and tells it when the page is
// hidden. Returns the client (null until the viewer is known); components read it with useSyncExternalStore.
import { useEffect, useState } from 'react'
import { createPresenceClient, linkMode } from './presenceClient.js'

export function usePresence(ctl) {
  const { uid, phase, status, sendEphemeral, subscribeEphemeral } = ctl
  const [client, setClient] = useState(null)

  useEffect(() => {
    if (!uid) return undefined
    const c = createPresenceClient({
      selfUid: uid, send: sendEphemeral,
      requestFrame: (fn) => window.requestAnimationFrame(fn), cancelFrame: (id) => window.cancelAnimationFrame(id),
    })
    setClient(c)
    return () => { c.destroy(); setClient(null) }
  }, [uid, sendEphemeral])

  useEffect(() => (client ? subscribeEphemeral((msg, from, cid) => client.receive(msg, from, cid)) : undefined), [client, subscribeEphemeral])

  // Before the live switch below, so a page that starts hidden never says hello.
  useEffect(() => {
    if (!client) return undefined
    const update = () => client.setVisible(document.visibilityState !== 'hidden')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [client])

  // A reconnect blip only pauses presence, so people do not vanish and come back announced as new (see linkMode).
  const mode = linkMode(phase, status)
  useEffect(() => { client?.setLink(mode) }, [client, mode])

  return client
}
