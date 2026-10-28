import { BOARD_TEMPLATES } from '../../lib/templates.js'
import { CanvasIcon, GiftIcon, LoopIcon, SparkIcon } from '../site/icons.jsx'

const labels = (type, keys) => keys.map((k) => BOARD_TEMPLATES[type][k].label)

const TYPES = [
  {
    key: 'workshop', Icon: CanvasIcon, title: 'Workshop canvas',
    text: 'An open canvas for planning, brainstorming and mapping ideas together. Drop in notes, text, shapes, images and connectors.',
    templates: labels('workshop', ['blank', 'retro', 'brainstorm', 'swot']),
  },
  {
    key: 'celebration', Icon: GiftIcon, title: 'Celebration board',
    text: 'Collect cards, messages and GIFs for a birthday, promotion or farewell, then reveal them all at once with confetti.',
    templates: labels('celebration', ['birthday', 'promotion', 'farewell', 'welcome']).concat('and more'),
  },
  {
    key: 'retro', Icon: LoopIcon, title: 'Retro board',
    text: 'Went Well / Could Be Improved / Blockers / Ideas, Start / Stop / Continue and Mad / Sad / Glad templates, voting, a shared timer and an optional AI-written summary you review before sharing.',
    templates: ['Went Well / Could Be Improved / Blockers / Ideas', 'Start / Stop / Continue', 'Mad / Sad / Glad'],
  },
  {
    key: 'wall', Icon: SparkIcon, title: 'Team wall',
    text: 'A recognition feed that stays open: give shout-outs with badges, @mention a teammate, add a GIF and react with emoji. Birthdays and work anniversaries show up as a banner on the day.',
    templates: labels('wall', ['team']),
  },
]

export default function BoardTypes() {
  return (
    <section className="ls-section" aria-labelledby="types-title">
      <div className="rs-wrap">
        <header className="ls-head">
          <p className="ls-eyebrow">Board types</p>
          <h2 id="types-title" className="ls-h2">One place for the way your team meets</h2>
          <p className="ls-lede">Pick the kind of board that fits the moment. Every board works the same way to join.</p>
        </header>
        <ul className="ls-types">
          {TYPES.map(({ key, Icon, title, text, templates }) => (
            <li key={key} className="rs-card ls-type">
              <div className="ls-type-top">
                <span className="ls-tile"><Icon /></span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <ul className="ls-tpls" aria-label={`${title} templates`}>
                {templates.map((t) => <li key={t} className="rs-chip">{t}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
