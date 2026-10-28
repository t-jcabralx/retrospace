// Server helpers of the saved column templates routes (/api/templates): the shared guard, input check and public shape.
import { getStore } from './store.js'
import { getSessionUser, requireJson, requireSameOrigin, noStore } from './auth.js'
import { fail, tooMany, windowHit, retryAfterSecs } from './http.js'
import { validateColumns, cleanColumnTitle, MAX_COLUMN_TITLE } from './columns.js'

export const MAX_TEMPLATES = 30
export const TEMPLATE_TYPES = ['retro', 'workshop']
export const TEMPLATE_ID = /^tpl_[0-9a-f]{16}$/
const PER_MIN = 30

export const publicTemplate = ({ id, name, type, columns, createdAt }) => ({ id, name, type, columns, createdAt })

// -> { user, store } or { response }. Session first (401), then same-origin / JSON on writes, then 30 calls a minute per account.
export async function guard(req, { write, body = true }) {
  const store = getStore()
  const user = await getSessionUser(req, { store })
  if (!user) return { response: noStore(fail(401, 'Sign in')) }
  const blocked = write ? requireSameOrigin(req) || (body ? requireJson(req) : null) : null
  if (blocked) return { response: noStore(blocked) }
  if ((await windowHit(`tpl:${user.id}`, 60_000, { localFallback: true })) > PER_MIN) return { response: noStore(tooMany(retryAfterSecs(60_000))) }
  return { user, store }
}

export function validateTemplateInput(body) {
  const name = typeof body.name === 'string' ? cleanColumnTitle(body.name) : ''
  if (!name) return { ok: false, error: 'give the template a name' }
  if (Array.from(name).length > MAX_COLUMN_TITLE) return { ok: false, error: `template names can be up to ${MAX_COLUMN_TITLE} characters` }
  if (!TEMPLATE_TYPES.includes(body.type)) return { ok: false, error: 'type must be retro or workshop' }
  const c = validateColumns(body.columns)
  return c.ok ? { ok: true, name, type: body.type, columns: c.columns } : c
}
