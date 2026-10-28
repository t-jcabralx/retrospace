import { json, fail } from '../../../../lib/http.js'
import { noStore } from '../../../../lib/auth.js'
import { guard, TEMPLATE_ID } from '../../../../lib/templatesApi.js'

export const runtime = 'nodejs'

// Deletes one of the signed-in account's own templates. Someone else's (or an unknown) id is the same 404.
export async function DELETE(req, { params }) {
  const g = await guard(req, { write: true, body: false }) // a delete has no body, so only the same-origin check applies
  if (g.response) return g.response
  const { id } = await params
  if (typeof id !== 'string' || !TEMPLATE_ID.test(id) || !(await g.store.deleteTemplate(g.user.id, id))) return noStore(fail(404, 'Template not found'))
  return noStore(json({ ok: true }))
}
