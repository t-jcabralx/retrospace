// Pure state for the card slideshow: which card is showing and whether it advances by itself. Clamps at both ends; the
// automatic advance stops on the last card (it never loops). Reduced motion simply starts with autoplay off.
export const AUTO_MS = 7000
export const MAX_DOTS = 20

const clampIndex = (i, count) => Math.max(0, Math.min(Math.max(0, count - 1), i))

// Playing only makes sense with a next card to go to.
const settle = (s) => (s.playing && s.index >= s.count - 1 ? { ...s, playing: false } : s)

export const initSlideshow = (count, { autoplay = true } = {}) => {
  const n = Math.max(0, Math.floor(Number(count)) || 0)
  return settle({ index: 0, count: n, playing: Boolean(autoplay) && n > 1 })
}

export function slideshowReducer(state, action) {
  switch (action?.type) {
    case 'next': return settle({ ...state, index: clampIndex(state.index + 1, state.count) })
    case 'prev': return { ...state, index: clampIndex(state.index - 1, state.count) }
    case 'home': return { ...state, index: 0 }
    case 'end': return settle({ ...state, index: clampIndex(state.count - 1, state.count) })
    case 'goto': return Number.isFinite(action.index) ? settle({ ...state, index: clampIndex(Math.trunc(action.index), state.count) }) : state
    case 'auto': return state.playing ? settle({ ...state, index: clampIndex(state.index + 1, state.count) }) : state
    case 'pause': return state.playing ? { ...state, playing: false } : state
    case 'play': {
      if (state.count < 2 || action.reduced) return state // reduced motion: the show never advances by itself
      return { ...state, playing: true, index: state.index >= state.count - 1 ? 0 : state.index } // at the end, play starts over
    }
    case 'toggle': return slideshowReducer(state, { type: state.playing ? 'pause' : 'play', reduced: action.reduced })
    case 'count': { // cards were added or removed while the show runs: keep the place, never restart a show that has ended
      const count = Math.max(0, Math.floor(Number(action.count)) || 0)
      return settle({ ...state, count, index: clampIndex(state.index, count) })
    }
    default: return state
  }
}

// The cards of a board for the show, in stacking order (z, then id); deleted items and other kinds are left out.
export function orderCards(items) {
  return (items ?? [])
    .filter((i) => i.kind === 'card' && !i.deleted)
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export const dotMode = (count) => (count <= MAX_DOTS ? 'dots' : 'bar')

// What a key does on the slide screen (null: leave it alone). Space toggles play/pause, except under reduced motion, where
// there is no autoplay and no Pause button, so Space just goes to the next card. A focused button or link keeps its own Space.
export function slideKeyAction(key, { reduced = false, tag = '' } = {}) {
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return null
  const arrow = { ArrowRight: 'next', ArrowLeft: 'prev', Home: 'home', End: 'end' }[key]
  if (arrow) return arrow
  if (key === ' ' && tag !== 'BUTTON' && tag !== 'A') return reduced ? 'next' : 'toggle'
  return null
}

// Cards arriving in a show that had nothing to advance to (0 or 1 card) start it, unless the viewer paused it or the
// device asks for reduced motion. A show that is already running or has been stopped on its last card is left alone.
export const shouldAutoStart = (prevCount, count, { userPaused = false, reduced = false } = {}) =>
  prevCount < 2 && count >= 2 && !userPaused && !reduced
