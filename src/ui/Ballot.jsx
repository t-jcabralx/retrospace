'use client'
// "Your ballot": a card for the person voting. One token per vote (filled once spent), the notes their votes are on with a
// way to jump to each and to take one back, and a line for the host with how many people have voted (counts, never names).
// Voting itself still happens with the vote button on a note.
import { perPerson, myVotes, ballotSummary, excerpt } from './voteResults.js'
import './ballot.css'

const plural = (n, one, many) => (n === 1 ? one : many)

export default function Ballot({ ctl, onJump }) {
  const { board, items, uid, isOwner } = ctl
  const per = perPerson(board)
  const mine = myVotes(items, uid)
  const left = Math.max(0, per - mine.length)
  const sum = ballotSummary(board, items, ctl.state?.participants ?? [])
  return (
    <section className="bd-ballot" aria-label="Your ballot">
      <header className="bd-ballot-head">
        <strong>Your ballot</strong>
        <span className="bd-ballot-left" aria-live="polite">{left === 0 ? 'All votes placed' : `${left} of ${per} left`}</span>
      </header>
      <ul className="bd-tokens" aria-hidden="true">
        {Array.from({ length: per }, (_, i) => <li key={i} className={i < mine.length ? 'is-used' : ''}>{i < mine.length ? '✓' : ''}</li>)}
      </ul>
      {mine.length > 0 ? (
        <ul className="bd-ballot-list" aria-label="Where your votes are">
          {mine.map((i) => (
            <li key={i.id}>
              <button type="button" className="bd-ballot-note" onClick={() => onJump(i.id)}>{excerpt(i, 44)}</button>
              <button type="button" className="bd-sbtn bd-ballot-take" aria-label={`Take back your vote on ${excerpt(i, 30)}`} onClick={() => ctl.vote(i.id)}>Take back</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bd-ballot-hint">You have not voted yet. Press the vote button on a note to spend a vote.</p>
      )}
      {left === 0 && mine.length > 0 && <p className="bd-ballot-hint is-done">All your votes are placed. Take one back if you want to move it.</p>}
      {isOwner && (
        <p className="bd-ballot-host">
          <strong>{sum.voters}</strong> of {sum.people} {plural(sum.people, 'person', 'people')} {plural(sum.voters, 'has', 'have')} voted, <strong>{sum.finished}</strong> used all their votes.
        </p>
      )}
    </section>
  )
}
