// One rule for "has the reveal time come?", shared by the reveal route (server) and the reveal page (browser).
const asMs = (v) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN)

// Ready for a viewer when they own the board, when no (valid) reveal time is set, or when it has passed on the SERVER's
// clock. `now` is the caller's clock and `offset` = server minus caller (0 on the server itself). The boundary is inclusive.
export function isRevealed(board, now, role, offset = 0) {
  if (role === 'owner') return true
  const at = asMs(board?.revealAt)
  if (!Number.isFinite(at)) return true
  return at <= now + (Number.isFinite(offset) ? offset : 0)
}
