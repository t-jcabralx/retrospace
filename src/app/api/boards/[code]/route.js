import { checkPatch, resolvePatch } from '../../../../lib/boardPatch.js'
import { authorize, requireOwner, boardRoute, viewerBoard } from '../../../../lib/access.js'
import { json, fail, parseBody } from '../../../../lib/http.js'
import { noStore, withCookie } from '../../../../lib/auth.js'
import { isCid } from '../../../../lib/ids.js'
import { forgetBoard } from '../../../../lib/boardCache.js'
import { ensureGuest, publicId, publicIdForUser } from '../../../../lib/guest.js'
import { aiReady, aiOf, STALE_MS } from '../../../../lib/aiBoard.js'
import { getProvider, providerInfo } from '../../../../lib/ai/provider.js'
import { announce, generateSummary, releaseClaim } from '../../../../lib/summary.js'
import { publish } from '../../../../lib/rt.js'
import { runAfter } from '../../../../lib/background.js'
import { viewerItems } from '../../../../lib/anon.js'
import { resolvePersona, publicPersona, publicParticipant, MAX_PARTICIPANTS } from '../../../../lib/participants.js'

export const runtime = 'nodejs'
export const maxDuration = 60 // an automatic summary runs after the response, inside this budget

export const GET = boardRoute(async (req, { code, board, store }) => {
  const viewer = await authorize(req, board)
  // The server mints the browser's guest identity (a signed cookie it cannot forge) the first time it is seen. What this
  // board shows of it is a per-board public id, never the cookie's uid; the owner's id comes from the account instead,
  // and they appear with their account persona. `viewer.persona` is null until a guest has chosen how to appear.
  const guest = ensureGuest(req)
  const id = viewer.role === 'owner' ? publicIdForUser(code, viewer.user.id) : publicId(code, guest.uid)
  await resolvePersona(store, code, id, viewer)
  // The people list (names, birthdays) is the owner's; guests are not sent it until a feature needs them to see it.
  const [items, people, all] = await Promise.all([store.listItems(code), viewer.role === 'owner' ? store.listPeople(code) : [], store.listParticipants(code)])
  // At most 300 people plus the owner's own row are listed, however the board got there.
  const mine = all.find((p) => p.uid === id)
  const who = { role: viewer.role, ...(viewer.user && { userId: viewer.user.id }), ...(viewer.role === 'owner' && { accountName: viewer.user.name, ai: providerInfo() }), uid: id, persona: publicPersona(mine) }
  const res = noStore(json({ board: viewerBoard(board, viewer.role), items: viewerItems(items, { viewerId: id, role: viewer.role }), people, participants: all.slice(0, MAX_PARTICIPANTS + 1).map(publicParticipant), viewer: who, now: Date.now() }))
  return guest.setCookie ? withCookie(res, guest.setCookie) : res
})

export const PATCH = boardRoute(async (req, { code, board, store }) => {
  await requireOwner(req, board)
  const [body, bad] = await parseBody(req)
  if (bad) return bad
  if (body.cid !== undefined && !isCid(body.cid)) return fail(400, 'invalid cid')
  const r = await checkPatch(body.patch)
  if (r.error) return fail(400, r.error)
  const resolved = resolvePatch(board, r.value)
  if (resolved.error) return fail(400, resolved.error)
  let updated = await store.updateBoard(code, resolved.value)
  forgetBoard(code) // /api/rt/send reads the board through a short cache
  if (!updated) return fail(404, 'Board not found') // deleted while this request was running

  // Closing a board with automatic summaries on: take the writing slot now (once per closure, atomically, so a repeated or
  // racing PATCH cannot start a second), and write the summary after the response has gone out.
  const closing = r.value.status === 'closed' && board.status !== 'closed'
  if (closing && aiReady(updated) && aiOf(updated).autoSummary && getProvider()) {
    const taken = await store.claimSummary(code, { staleMs: STALE_MS, autoFor: updated.closedAt })
    if (taken) {
      updated = taken
      try {
        await runAfter(() => generateSummary(code, { auto: true, claimed: true }).catch((e) => console.error('retrospace: automatic summary failed:', e?.message)))
      } catch (e) {
        // after() is unavailable or refused the task: give the slot back (the closure may be tried again) and answer the PATCH as usual.
        console.error('retrospace: could not schedule the automatic summary:', e?.message)
        updated = (await releaseClaim(code, { store })) ?? updated
      }
    }
  }
  // Everyone watching sees the new settings at once. Only the guest-safe view goes out (the channel reaches every
  // guest): never ownerId, createdBy, the passcode hash or a draft summary. `cid` names the tab so it can skip its echo,
  // exactly as for ops.
  await announce(updated, body.cid)
  return noStore(json({ board: viewerBoard(updated, 'owner') }))
}, { mutating: true })

// No body is needed, so only the same-origin guard applies.
export const DELETE = boardRoute(async (req, { code, board, store }) => {
  await requireOwner(req, board)
  await store.deleteBoard(code)
  forgetBoard(code)
  // Open clients stop polling a board that is gone (a 404 there is terminal). Nothing but the fact goes out.
  await publish(code, { t: 'deleted', from: publicIdForUser(code, board.ownerId) })
  return noStore(json({ ok: true }))
}, { mutating: true, json: false })
