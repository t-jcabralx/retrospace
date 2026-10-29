import Image from 'next/image'
import { BOARD_TEMPLATES } from '../../lib/templates.js'
import { CanvasIcon, GiftIcon, LoopIcon, SparkIcon, PartyIcon } from '../site/icons.jsx'
import { WheelArt } from './Illustrations.jsx'

const labels = (type, keys) => keys.map((k) => BOARD_TEMPLATES[type][k].label)

const TYPES = [
  {
    key: 'workshop', photo: '/photos/workshop.jpg', Icon: CanvasIcon, title: 'Workshop canvas',
    text: 'An open canvas for planning, brainstorming and mapping ideas together. Drop in notes, text, shapes, images and connectors.',
    templates: labels('workshop', ['blank', 'retro', 'brainstorm', 'swot']),
  },
  {
    key: 'celebration', photo: '/photos/celebration.jpg', Icon: GiftIcon, title: 'Celebration board',
    text: 'Collect cards, messages and GIFs for a birthday, promotion or farewell, then reveal them all at once with confetti.',
    templates: labels('celebration', ['birthday', 'promotion', 'farewell', 'welcome']).concat('and more'),
  },
  {
    key: 'retro', photo: '/photos/retro.jpg', Icon: LoopIcon, title: 'Retro board',
    text: 'Went Well / Could Be Improved / Blockers / Ideas, Start / Stop / Continue and Mad / Sad / Glad templates, voting, a shared timer and an optional AI-written summary you review before sharing.',
    templates: ['Went Well / Could Be Improved / Blockers / Ideas', 'Start / Stop / Continue', 'Mad / Sad / Glad'],
  },
  {
    key: 'event', art: 'wheel', Icon: PartyIcon, title: 'Event raffle',
    text: 'A two-ring prize wheel for raffles and give-aways: people on the outer ring, prizes on the inner ring, a two-step draw everyone watches live, with your own winner celebration.',
    templates: ['Raffle day', 'Team lunch pick', 'Holiday party raffle', 'Conference giveaway'],
  },
  {
    key: 'wall', photo: '/photos/wall.jpg', Icon: SparkIcon, title: 'Team wall',
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
          {TYPES.map(({ key, photo, art, Icon, title, text, templates }) => (
            <li key={key} className="rs-card ls-type">
              <div className={`ls-photo${art ? ' ls-photo--art' : ''}`}>
                {art ? <WheelArt /> : <Image src={photo} alt="" fill sizes="(min-width: 900px) 33vw, 100vw" />}
              </div>
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
