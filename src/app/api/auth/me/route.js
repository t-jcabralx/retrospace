import { json, fail } from '../../../../lib/http.js'
import { getSessionUser, noStore } from '../../../../lib/auth.js'

export const runtime = 'nodejs'

// 401 when signed out. The pages ask with ?soft=1 instead and get 200 { user: null }, because a browser logs every 401
// as a console error and a visitor who is simply not signed in is not an error.
export async function GET(req) {
  const user = await getSessionUser(req)
  const soft = new URL(req.url).searchParams.get('soft') === '1'
  return noStore(user ? json({ user }) : soft ? json({ user: null }) : fail(401, 'Not signed in'))
}
