// Server-only: the shout-out rate limit. 10 shout-out adds a minute per participant per board, counted in the same fixed
// windows as every other limit (Redis when configured, in-process otherwise). `uid` is the participant's PUBLIC board id.
import { windowHit } from './http.js'
import { SHOUTOUT_PER_MINUTE, SHOUTOUT_WINDOW_MS } from './wall.js'

// ops: validated ops. -> { allowed, rejected }; `rejected` holds the shout-out adds over the limit as { id, error }.
// Nothing is refunded on success: every attempted add counts.
export async function throttleShoutouts(ops, code, uid, hit = windowHit) {
  const allowed = []
  const rejected = []
  for (const o of ops) {
    if (o.op !== 'add' || o.item.kind !== 'shoutout') { allowed.push(o); continue }
    const n = await hit(`shout:${code}:${uid}`, SHOUTOUT_WINDOW_MS, { localFallback: true })
    if (n > SHOUTOUT_PER_MINUTE) rejected.push({ id: o.id, error: 'Slow down' })
    else allowed.push(o)
  }
  return { allowed, rejected }
}
