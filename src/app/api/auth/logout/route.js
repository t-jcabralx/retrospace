import { getStore } from '../../../../lib/store.js'
import { hashKey } from '../../../../lib/hash.js'
import { json } from '../../../../lib/http.js'
import { requireJson, requireSameOrigin, sessionToken, clearSessionCookie, noStore, withCookie } from '../../../../lib/auth.js'

export const runtime = 'nodejs'

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  const token = sessionToken(req)
  if (token) await getStore().deleteSession(hashKey(token))
  // The guest cookie stays: it is the browser's own guest identity, unrelated to the account. An owner is identified on
  // their boards by the account (see guest.js), so nothing of theirs is left on this browser for the next person.
  return withCookie(json({ ok: true }), clearSessionCookie())
}

export async function POST(req) {
  return noStore(await handle(req))
}
