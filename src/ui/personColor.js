// A person's colour on the board: the body colour of their avatar (a --pa-* token from persona.css), so a cursor, an
// outline and the avatar next to a name all match. --pa-ink text on top of it measures 6.3:1 to 10.1:1 across the eight body colours (4.5:1 is needed).
import { AVATAR_PARTS } from '../lib/persona.js'

export const personColor = (avatar) => {
  const n = Number.isInteger(avatar?.body) && avatar.body >= 0 && avatar.body < AVATAR_PARTS.body ? avatar.body : 0
  return `var(--pa-body-${n})`
}
