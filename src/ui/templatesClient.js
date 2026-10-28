// Browser calls to the saved column templates routes. Like site/api.js they never throw: no answer is status 0.
import { getJson, postJson } from './site/api.js'

export const listTemplates = () => getJson('/api/templates')
export const saveTemplate = (body) => postJson('/api/templates', body)
export async function deleteTemplate(id) {
  try {
    const res = await fetch(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE', cache: 'no-store' })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}

export function templateMessage(r, fallback = 'Something went wrong. Please try again.') {
  if (r.status === 0) return 'Couldn’t reach the server. Check your connection and try again.'
  if (r.status === 401) return 'Sign in to use saved templates.'
  if (r.status === 429) return 'Too many tries. Wait a moment and try again.'
  const e = r.data?.error
  return typeof e === 'string' && e ? e[0].toUpperCase() + e.slice(1) : fallback
}
