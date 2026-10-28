// Pure rules for the recipient's reveal page.
import { EFFECTS } from './effects-engine.js'
import { getTemplate } from '../lib/templates.js'
import { isRevealed } from '../lib/reveal.js'

// 'countdown' while revealAt is still ahead on the SERVER's clock (now is the client's; serverOffset = server - client),
// otherwise 'ready'. The owner always sees the board (a preview), and a board with no reveal time is ready at once.
export const revealPhase = (board, now, role, serverOffset = 0) => (isRevealed(board, now, role, serverOffset) ? 'ready' : 'countdown')

// The celebration effect for the intro: the board's theme (set from its occasion template), else the template's, else confetti.
export function revealEffect(board) {
  const own = board?.theme?.effect
  if (EFFECTS.includes(own)) return own
  const fromTemplate = board ? getTemplate(board.type, board.template)?.theme?.effect : null
  return EFFECTS.includes(fromTemplate) ? fromTemplate : 'confetti'
}

export function firstName(recipient) {
  const name = typeof recipient === 'string' ? recipient : recipient?.name
  return typeof name === 'string' ? name.trim().split(/\s+/)[0] ?? '' : ''
}

const STEPS = ['intro', 'slides', 'board']

// What to show: the gate while the reveal is ahead, else the step the viewer is on (the intro to start with).
export function revealStage({ phase, step }) {
  if (phase === 'countdown') return 'countdown'
  return STEPS.includes(step) ? step : 'intro'
}
