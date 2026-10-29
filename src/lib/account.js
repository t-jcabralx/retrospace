// Removing an account and everything it owns. Server only. The order matters: boards first (their content and people), then
// templates and sign-ins, and the account itself last, so a failure part-way leaves an account that can try again.
import { forgetBoard } from './boardCache.js'
import { publish } from './rt.js'
import { publicIdForUser } from './guest.js'

// -> { boards: n } the number of boards removed.
export async function deleteAccount(store, user, { announce = true } = {}) {
  const boards = await store.listBoardsByOwner(user.id)
  for (const b of boards) {
    await store.deleteBoard(b.code)
    forgetBoard(b.code)
    // People who have the board open stop polling a board that is gone; nothing but the fact goes out.
    if (announce) await publish(b.code, { t: 'deleted', from: publicIdForUser(b.code, user.id) }).catch(() => {})
  }
  await store.deleteTemplatesByOwner(user.id)
  await store.deleteSessionsByUser(user.id)
  await store.deleteUser(user.id)
  return { boards: boards.length }
}
