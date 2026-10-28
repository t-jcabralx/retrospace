'use client'
import { useEffect, useId, useState } from 'react'
import { Section, Switch, SaveNote } from './controls.jsx'
import ResetVotes from './ResetVotes.jsx'
import { useSetting } from './useSetting.js'
import { perPerson } from '../voteResults.js'

// Start or stop voting, how many votes each person gets, and a fresh round.
export default function VotingSection({ board, patchBoard, resetVotes }) {
  const id = useId()
  const active = Boolean(board.vote?.active)
  const per = perPerson(board)
  const toggle = useSetting(patchBoard)
  const count = useSetting(patchBoard)
  const [value, setValue] = useState(String(per))
  const [problem, setProblem] = useState('')
  useEffect(() => { setValue(String(per)) }, [per])

  async function commit() {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1 || n > 20) { setProblem('Enter a whole number from 1 to 20.'); return }
    setProblem('')
    if (n === per) return
    if (!(await count.save({ vote: { active, perPerson: n } }))) setValue(String(per))
  }

  return (
    <Section title="Voting">
      <Switch
        label="Voting open"
        desc={active ? `Everyone can give up to ${per} ${per === 1 ? 'vote' : 'votes'}. Stop to see the results.` : 'Start a round so everyone can vote for the notes they like best.'}
        checked={active}
        disabled={toggle.busy}
        onChange={(next) => toggle.save({ vote: { active: next, perPerson: per } })}
      >
        <SaveNote setting={toggle} />
      </Switch>
      <div className="bd-set-item">
        <label className="bd-set-label" htmlFor={id}>Votes per person</label>
        <input
          id={id}
          className="bd-sinput bd-sinput--short"
          type="number"
          inputMode="numeric"
          min="1"
          max="20"
          step="1"
          value={value}
          disabled={count.busy}
          aria-invalid={problem ? 'true' : undefined}
          aria-describedby={`${id}-e`}
          onChange={(e) => { setValue(e.target.value); setProblem('') }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        />
        <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
        <SaveNote setting={count} />
      </div>
      <div className="bd-set-item">
        <p className="bd-set-desc">Start a new round by clearing every vote on the board.</p>
        <ResetVotes resetVotes={resetVotes} />
      </div>
    </Section>
  )
}
