import { getStore } from '../../../lib/store.js'
import { json, fail, stripBoard } from '../../../lib/http.js'
import { getSessionUser, noStore } from '../../../lib/auth.js'

export const runtime = 'nodejs'

// The signed-in account's own boards, most recently updated first.
export async function GET(req) {
  const store = getStore()
  const user = await getSessionUser(req, { store })
  if (!user) return noStore(fail(401, 'Sign in'))
  const boards = await store.listBoardsByOwner(user.id)
  // The hash stays server-side; the flag lets the dashboard show a Passcode chip. Summary text is not needed for the cards.
  return noStore(json({ boards: boards.map((b) => { const { summary, ...rest } = stripBoard(b); return { ...rest, hasPasscode: !!b.passcodeHash, hasSummary: Boolean(summary) } }) })) // eslint-disable-line no-unused-vars
}
