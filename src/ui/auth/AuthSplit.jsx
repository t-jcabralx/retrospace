import Image from 'next/image'
import { LogoMark } from '../site/Logo.jsx'
import './auth.css'

// Sign in and sign up: a photo and a few plain lines beside the form (above it on a phone).
const COPY = {
  login: {
    photo: '/photos/auth-signin.jpg',
    title: 'Pick up where your team left off',
    points: ['Your boards are ready to open', 'Guests still join with just a code', 'Retros, workshops, raffles and celebrations in one place'],
  },
  register: {
    photo: '/photos/auth-signup.jpg',
    title: 'Run your next session in minutes',
    points: ['Create a board and share a six-character code', 'Guests join without an account', 'Spin a prize wheel, run a retro or celebrate someone'],
  },
}

export default function AuthSplit({ mode, children }) {
  const c = COPY[mode]
  return (
    <div className="au">
      <aside className="au-art">
        <Image src={c.photo} alt="" fill priority sizes="(min-width: 900px) 50vw, 100vw" />
        <div className="au-shade" aria-hidden="true" />
        <div className="au-copy">
          <span className="au-brand"><LogoMark size={26} /><b>Retrospace</b></span>
          <h2>{c.title}</h2>
          <ul>{c.points.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      </aside>
      <div className="au-form">{children}</div>
    </div>
  )
}
