import { PRESET_TITLES, columnsFromTitles, layoutColumns, validateHeader } from './columns.js'

const nameOf = (r) => (typeof r === 'string' ? r : r?.name)?.trim() || ''
const text = (id, x, y, w, h, t) => ({ id, kind: 'text', x, y, w, h, z: 0, rot: 0, data: { text: t } })
const frame = (id, x, title) => ({ id, kind: 'frame', x, y: 0, w: 360, h: 520, z: 0, rot: 0, data: { title } })

const workshop = (key, label, emoji, accent, frames = []) => ({
  key, label, emoji,
  theme: { bg: '#f7f7f4', pattern: 'dots', accent, effect: 'confetti' },
  title: () => label,
  // `opts.columns` ([{ title, emoji }], see columns.js) replaces the built-in frames of a workshop template that has any.
  columns: frames.length ? columnsFromTitles(frames) : null,
  starterItems: (_recipient, opts) => (opts?.columns && frames.length
    ? layoutColumns(opts.columns, { h: 520, gap: 40, top: 0 })
    : frames.map((f, i) => frame(`starter-frame-${i + 1}`, i * 400, f))),
})

// Celebration: header text carries the recipient; effect varies by occasion.
const celebration = (key, label, emoji, bg, pattern, accent, effect, headline) => {
  const title = (r) => `${headline}${nameOf(r) ? `, ${nameOf(r)}` : ''}!`
  return {
    key, label, emoji,
    theme: { bg, pattern, accent, effect },
    title,
    starterItems: (recipient) => [text('starter-header', 0, -140, 640, 80, title(recipient))],
  }
}

// Retro: a one-line instruction header over equal columns laid out left to right. Each column is a frame, so a note's
// column is simply the frame it sits in (src/lib/ai/input.js reads it the same way).
const COL_W = 360
const COL_H = 640
const COL_GAP = 24
const COL_TOP = 140
const retro = (key, label, emoji, accent, columns) => ({
  key, label, emoji,
  theme: { bg: '#f7f7f4', pattern: 'dots', accent, effect: 'confetti' },
  title: () => 'Sprint retrospective',
  columns: columnsFromTitles(columns),
  // `opts` = { columns, header } from the dialog (already validated by columns.js); without it the built-in layout.
  starterItems: (_recipient, opts) => {
    const cols = opts?.columns ?? columnsFromTitles(columns)
    const header = opts?.header ?? validateHeader().value
    return [
      text('starter-header', 0, 40, cols.length * (COL_W + COL_GAP) - COL_GAP, 60, header),
      ...layoutColumns(cols, { w: COL_W, h: COL_H, gap: COL_GAP, top: COL_TOP }),
    ]
  },
})

export const BOARD_TEMPLATES = {
  workshop: {
    blank: workshop('blank', 'Blank board', '⬜', '#4f6df5'),
    retro: workshop('retro', 'Retrospective', '🔁', '#2f9e6f', PRESET_TITLES.retro),
    brainstorm: workshop('brainstorm', 'Brainstorm', '💡', '#f5a623', PRESET_TITLES.brainstorm),
    swot: workshop('swot', 'SWOT analysis', '🧭', '#7c4dff', PRESET_TITLES.swot),
  },
  celebration: {
    birthday: celebration('birthday', 'Birthday', '🎂', '#fff1f5', 'balloons', '#ff5c8a', 'balloons', 'Happy Birthday'),
    promotion: celebration('promotion', 'Promotion', '🚀', '#eef4ff', 'stars', '#3b6cf6', 'fireworks', 'Congratulations on your promotion'),
    farewell: celebration('farewell', 'Farewell', '👋', '#fff7ea', 'dots', '#e0802b', 'confetti', 'We will miss you'),
    anniversary: celebration('anniversary', 'Work anniversary', '🏆', '#fffbe8', 'stars', '#d4a017', 'fireworks', 'Happy work anniversary'),
    welcome: celebration('welcome', 'Welcome', '🤝', '#eefaf3', 'dots', '#2f9e6f', 'confetti', 'Welcome to the team'),
    baby: celebration('baby', 'New baby', '🍼', '#f0f8ff', 'balloons', '#5aa9e6', 'confetti', 'Congratulations on your new baby'),
    congrats: celebration('congrats', 'Congratulations', '🎉', '#fdf2ff', 'confetti', '#b84dd8', 'fireworks', 'Congratulations'),
    thanks: celebration('thanks', 'Thank you', '💛', '#fffbea', 'dots', '#f0b429', 'confetti', 'Thank you'),
  },
  retro: {
    'retro-wwci': retro('retro-wwci', 'Went Well / Could Be Improved', '✅', '#2f9e6f', PRESET_TITLES['retro-wwci']),
    'retro-ssc': retro('retro-ssc', 'Start / Stop / Continue', '🚦', '#4f6df5', PRESET_TITLES['retro-ssc']),
    'retro-msg': retro('retro-msg', 'Mad / Sad / Glad', '🎭', '#e0568a', PRESET_TITLES['retro-msg']),
  },
  wall: {
    team: {
      key: 'team', label: 'Team wall', emoji: '🌟',
      theme: { bg: '#f4f7ff', pattern: 'dots', accent: '#4f6df5', effect: 'confetti' },
      title: () => 'Team wall',
      starterItems: () => [text('starter-header', 0, -140, 640, 80, 'Shout-outs')],
    },
  },
}

export function getTemplate(type, key) {
  const group = Object.hasOwn(BOARD_TEMPLATES, type) ? BOARD_TEMPLATES[type] : null
  return group && Object.hasOwn(group, key) ? group[key] : null
}
