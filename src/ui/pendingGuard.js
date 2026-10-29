// Copies of items that arrive from the server (a poll, the catch-up after the connection reopened, a peer's broadcast) are not
// applied to an item this viewer has changes in flight for. Those copies were made before the changes were saved, so applying them
// puts the old size, position or text back on the screen until the save is answered; the answer to the save brings the item as
// the server now has it, the viewer's changes and everybody else's together.
// `sentAt`: when the last change to each item was handed to sync. A change still unanswered after PENDING_MAX_MS no longer holds the
// item back, so a lost answer can never freeze an item against the server for good.
export const PENDING_MAX_MS = 30_000
export const withoutPending = (docs, pending, sentAt = new Map(), now = Date.now()) =>
  docs.filter((d) => !((pending.get(d?.id) ?? 0) > 0 && now - (sentAt.get(d?.id) ?? 0) < PENDING_MAX_MS))
