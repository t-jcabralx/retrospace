// Pure: the op that posts a shout-out. The canvas slot is a three-column grid, one after the last; the data is exactly what
// the server's shoutout rule takes (validate.js), plus the post time the feed sorts by.
import { addOp, nextZ } from './ops.js'
import { buildShoutoutData, shoutoutSlot } from '../lib/wall.js'

export function buildShoutoutOp(items, fields, id, now = Date.now()) {
  const count = items.filter((i) => i.kind === 'shoutout' && !i.deleted).length
  return addOp('shoutout', shoutoutSlot(count), buildShoutoutData(fields, now), nextZ(items, 'shoutout'), id)
}
