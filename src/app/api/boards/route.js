import { getStore } from '../../../lib/store.js'
import { validateBoardInput, validateOp } from '../../../lib/validate.js'
import { getTemplate } from '../../../lib/templates.js'
import { publicIdForUser } from '../../../lib/guest.js'
import { resolvePersona } from '../../../lib/participants.js'
import { avatarFromSeed } from '../../../lib/persona.js'
import { DEFAULT_THROW_EMOJIS } from '../../../lib/emoji.js'
import { defaultRetro } from '../../../lib/retro.js'
import { AI_DEFAULTS } from '../../../lib/aiBoard.js'
import { createBoardWithStarter, CodeAllocationError } from '../../../lib/boards.js'
import { json, fail, parseBody, rateLimited } from '../../../lib/http.js'
import { requireJson, requireSameOrigin, getSessionUser, noStore } from '../../../lib/auth.js'

export const runtime = 'nodejs'

async function handle(req) {
  const blocked = requireSameOrigin(req) || requireJson(req)
  if (blocked) return blocked
  if (await rateLimited(req, 'bcreate', 20)) return fail(429, 'slow down')
  const store = getStore()
  const user = await getSessionUser(req, { store })
  if (!user) return fail(401, 'Sign in to create a board')
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  const v = validateBoardInput(body)
  if (!v.ok) return fail(400, v.error)
  const { type, template, title, recipient, columns, header, votes } = v.board
  // The starter items are authored by the owner's account id on this board (guest.js) under their account name and
  // avatar; nothing about who writes them comes from the body, and no browser cookie is involved.

  const tpl = getTemplate(type, template)
  const makeBoard = (code) => ({
    code, type, template, title, recipient,
    theme: tpl.theme,
    ownerId: user.id,
    createdBy: user.id,
    passcodeHash: null,
    status: 'open',
    revoked: false,
    revealAt: null,
    vote: { active: false, perPerson: votes ?? 3 },
    timer: null,
    throwables: { enabled: false, emojis: [...DEFAULT_THROW_EMOJIS] },
    ai: { ...AI_DEFAULTS }, // AI summaries stay off until the owner switches them on and acknowledges the notice
    summary: null,
    summaryState: 'idle',
    closedAt: null,
    ...(type === 'retro' && { retro: defaultRetro(votes ?? undefined) }), // the staged workflow; boards without it behave as before
  })

  // Check the template before anything is created, so a bad template leaves nothing behind.
  const checked = tpl.starterItems(recipient?.name, { columns, header }).map((item) => validateOp({ op: 'add', item }))
  if (!checked.every((c) => c.ok)) return fail(500, 'template failed')
  try {
    const actor = (boardCode) => ({ uid: publicIdForUser(boardCode, user.id), name: user.name, avatar: avatarFromSeed(user.id), isOwner: true })
    const { code } = await createBoardWithStarter(store, makeBoard, checked.map((c) => c.op), actor)
    // Claim the owner's name on the board at once (best effort: the first owner request would do it anyway), so no
    // guest can register it first.
    try { await resolvePersona(store, code, publicIdForUser(code, user.id), { role: 'owner', user }) } catch (e) { console.error('retrospace: owner persona failed:', e?.message) }
    return json({ code })
  } catch (e) {
    if (e instanceof CodeAllocationError) return fail(503, 'Could not allocate a board code, try again')
    console.error('retrospace: creating a board failed:', e?.message)
    return fail(500, 'Could not create the board')
  }
}

export async function POST(req) {
  return noStore(await handle(req))
}
