import { validateOp } from '../../../../../lib/validate.js'
import { isCid } from '../../../../../lib/ids.js'
import { authorize, boardRoute } from '../../../../../lib/access.js'
import { boardId } from '../../../../../lib/guest.js'
import { resolvePersona } from '../../../../../lib/participants.js'
import { json, fail, parseBody, rateLimited, windowHit, tooMany, retryAfterSecs } from '../../../../../lib/http.js'
import { publish } from '../../../../../lib/rt.js'
import { slimApplied } from '../../../../../lib/broadcast.js'
import { viewerItems, opsEnvelopes } from '../../../../../lib/anon.js'
import { throttleShoutouts } from '../../../../../lib/wallLimit.js'

export const runtime = 'nodejs'

const MAX_OPS = 50
const MAX_BODY = 1.5 * 1024 * 1024 // a few downscaled pictures (an image op is at most 400 KB)
const PER_PERSON_PER_MIN = 300 // keyed by the board's public id, so one busy room behind a shared address is not shut out
const PER_IP_PER_MIN = 3000 // only a ceiling against abuse from one address

const handle = boardRoute(async (req, { code, board, store }) => {
  const viewer = await authorize(req, board, { write: true })
  // Who is writing comes from the signed guest cookie (or, for the owner, the session) and the stored participant
  // record, never from the body: a `uid`, `name` or `avatar` sent by the client is ignored, so nobody can write or edit
  // as someone else. `uid` below is this board's public id.
  const uid = boardId(req, code, viewer)
  if (!uid) return fail(401, 'Join the board first')
  if ((await windowHit(`opsid:${uid}`, 60_000)) > PER_PERSON_PER_MIN) return tooMany(retryAfterSecs(60_000))
  const [body, bad] = await parseBody(req, { max: MAX_BODY })
  if (bad) return bad
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  if (!Array.isArray(body.ops) || body.ops.length < 1 || body.ops.length > MAX_OPS) return fail(400, `ops must be 1..${MAX_OPS}`)
  const persona = await resolvePersona(store, code, uid, viewer)
  if (!persona) return fail(409, 'Choose a name first')

  let valid = []
  const rejected = []
  for (const raw of body.ops) {
    const v = validateOp(raw)
    if (v.ok) valid.push(v.op)
    else rejected.push({ id: typeof raw?.id === 'string' ? raw.id : undefined, error: v.error })
  }

  const slow = await throttleShoutouts(valid, code, uid) // team wall: at most 10 shout-outs a minute per participant
  valid = slow.allowed
  rejected.push(...slow.rejected)

  // The owner's powers come from the session alone.
  const actor = { uid, name: persona.name, avatar: persona.avatar, isOwner: viewer.role === 'owner' }
  const result = valid.length ? await store.applyOps(code, valid, actor) : { applied: [], rejected: [] }
  if (result.applied.length) for (const env of opsEnvelopes({ t: 'ops', from: uid, ...(body.cid && { cid: body.cid }), ops: slimApplied(result.applied, valid) })) await publish(code, env)
  return json({ applied: viewerItems(result.applied, { viewerId: uid, role: viewer.role }), rejected: [...rejected, ...result.rejected] })
}, { mutating: true })

export async function POST(req, ctx) {
  if (await rateLimited(req, 'ops', PER_IP_PER_MIN)) return fail(429, 'slow down')
  return handle(req, ctx)
}
