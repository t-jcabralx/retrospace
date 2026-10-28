import { randomBytes } from 'node:crypto'
import { json, fail, parseBody } from '../../../lib/http.js'
import { noStore } from '../../../lib/auth.js'
import { guard, validateTemplateInput, publicTemplate, MAX_TEMPLATES } from '../../../lib/templatesApi.js'

export const runtime = 'nodejs'

// The signed-in account's saved column templates, newest first.
export async function GET(req) {
  const g = await guard(req, { write: false })
  if (g.response) return g.response
  return noStore(json({ templates: (await g.store.listTemplates(g.user.id)).map(publicTemplate) }))
}

export async function POST(req) {
  const g = await guard(req, { write: true })
  if (g.response) return g.response
  const [body, bad] = await parseBody(req, { max: 64 * 1024 })
  if (bad) return noStore(bad)
  const v = validateTemplateInput(body)
  if (!v.ok) return noStore(fail(400, v.error))
  if ((await g.store.listTemplates(g.user.id)).length >= MAX_TEMPLATES) return noStore(fail(409, `You can keep up to ${MAX_TEMPLATES} templates. Delete one first.`))
  try {
    const doc = await g.store.createTemplate({ id: `tpl_${randomBytes(8).toString('hex')}`, ownerId: g.user.id, name: v.name, type: v.type, columns: v.columns, createdAt: Date.now() })
    return noStore(json({ template: publicTemplate(doc) }))
  } catch (e) {
    if (e?.code === 11000) return noStore(fail(409, 'You already have a template with that name'))
    console.error('retrospace: saving a template failed:', e?.message)
    return noStore(fail(500, 'Could not save the template'))
  }
}
