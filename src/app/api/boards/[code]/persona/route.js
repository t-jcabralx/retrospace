import { authorize, boardRoute, HttpError } from '../../../../../lib/access.js'
import { boardId } from '../../../../../lib/guest.js'
import { validatePersona } from '../../../../../lib/persona.js'
import { forgetParticipant, publicPersona, MAX_PARTICIPANTS } from '../../../../../lib/participants.js'
import { json, fail, parseBody, rateLimited, windowHit, windowRefund, tooMany, retryAfterSecs } from '../../../../../lib/http.js'
import { noStore } from '../../../../../lib/auth.js'

export const runtime = 'nodejs'

const CHANGES_PER_HOUR = 10
const WINDOW_MS = 3600_000
const NEW_PER_MINUTE = 100 // new participants per board per minute, whoever (or however many addresses) they come from
const MINUTE_MS = 60_000
const MAX_BODY = 4 * 1024 // a persona is a name and five small numbers

const taken409 = (error, suggestion) => json({ error, ...(suggestion && { suggestion }) }, 409)

// How the caller appears on this board. The first PUT creates the persona; later ones change it, but only while the
// participant has not authored anything (the owner may always change theirs: their starter items would otherwise lock
// it at once, and their powers never depend on authorship). The caller's id is this board's public id from the signed
// guest cookie (or, for the owner, from the session), never anything in the body. A board holds at most 300
// participants (the owner is exempt) and admits 100 new ones a minute.
const handle = boardRoute(async (req, { code, board, store }) => {
  const viewer = await authorize(req, board) // read access, passcode included
  const isOwner = viewer.role === 'owner'
  const uid = boardId(req, code, viewer)
  if (!uid) throw new HttpError(401, 'Join the board first')
  if (board.status === 'closed' && !isOwner) throw new HttpError(403, 'Board is closed')
  const [body, bad] = await parseBody(req, { max: MAX_BODY })
  if (bad) return bad

  const [existing, all, owner] = await Promise.all([
    store.getParticipant(code, uid),
    store.listParticipants(code),
    isOwner || !board.ownerId ? null : store.getUserById(board.ownerId),
  ])
  const taken = new Set(all.filter((p) => p.uid !== uid).map((p) => p.name)) // account personas included
  const checked = validatePersona(body.persona, { taken, ownerName: owner?.name, accountName: isOwner ? viewer.user.name : undefined })
  if (!checked.ok) return checked.status === 409 ? taken409(checked.error, checked.suggestion) : fail(checked.status, checked.error)

  const creating = !existing && !isOwner
  if (creating) {
    // The cap counts the people who joined, not the owner's own account row.
    if (all.filter((p) => p.kind !== 'account').length >= MAX_PARTICIPANTS) return fail(403, 'This board is full')
    if ((await windowHit(`pnew:${code}`, MINUTE_MS, { localFallback: true })) > NEW_PER_MINUTE) return tooMany(retryAfterSecs(MINUTE_MS), 'Too many people joining at once, try again shortly')
  }
  // The slot taken above is only for a row actually created: a failed write gives it back.
  const giveBack = () => (creating ? windowRefund(`pnew:${code}`, MINUTE_MS) : undefined)
  // Only attempts that would write count towards the hourly budget, so correcting a taken name is free.
  if ((await windowHit(`persona:${uid}`, WINDOW_MS, { localFallback: true })) > CHANGES_PER_HOUR) {
    await giveBack() // refused: it must not use up one of the board's new-person slots
    return tooMany(retryAfterSecs(WINDOW_MS), 'Too many name changes, try again later')
  }
  try {
    const stored = existing
      ? await store.updateParticipant(code, uid, checked.persona, { lockWhenAuthored: !isOwner })
      : await store.joinParticipant(code, uid, checked.persona)
    forgetParticipant(code, uid)
    if (creating && stored?.name !== checked.persona.name) await giveBack() // lost a race for this uid: nothing was created
    return noStore(json({ persona: publicPersona(stored) }))
  } catch (e) {
    await giveBack()
    if (e?.code === 'PERSONA_LOCKED') return fail(403, 'Persona is fixed once you have added something')
    if (e?.code === 11000) return taken409('That name is already taken on this board') // lost a race for the name
    throw e
  }
}, { mutating: true })

export async function PUT(req, ctx) {
  if (await rateLimited(req, 'persona', 300, { localFallback: true })) return noStore(tooMany(retryAfterSecs(60_000)))
  return handle(req, ctx)
}
