import '../wall.css'
import CardMedia from './CardMedia.jsx'
import { badgeLabel, CUSTOM_BADGE } from '../../lib/validate.js'

export const BADGE_EMOJI = { Teamwork: '🤝', 'Above & Beyond': '🚀', Innovation: '💡', 'Customer Hero': '🦸', 'Thank You': '💛' }

// A team-wall shout-out: badge, who it is for (a chip when it @mentions a person), the message, an optional GIF and who
// wrote it. Used on the canvas, in the feed and in the composer preview. Everything is React text, never markup.
export default function Shoutout({ item }) {
  const { toName, message, badge, gif, to, badgeEmoji } = item.data
  const icon = badge === CUSTOM_BADGE ? (badgeEmoji || '🌟') : (BADGE_EMOJI[badge] ?? '🌟')
  return (
    <div className="wl-card">
      <p className="wl-badge"><span aria-hidden="true">{icon} </span>{badgeLabel(item.data)}</p>
      <p className="wl-to">
        <span className="wl-to-pre">Shout-out to </span>
        <span className={`wl-chip${to ? ' is-mention' : ''}`}>{to ? '@' : ''}{toName}</span>
      </p>
      <p className="wl-msg">{message}</p>
      <CardMedia data={{ gif, message }} className="wl-media" />
      {item.authorName && <p className="wl-by"><span aria-hidden="true">— </span>{item.authorName}</p>}
    </div>
  )
}
