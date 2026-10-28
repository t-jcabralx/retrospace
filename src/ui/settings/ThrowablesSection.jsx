'use client'
import { useId, useState } from 'react'
import { Section, Switch, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'
import { isSingleEmoji, DEFAULT_THROW_EMOJIS } from '../../lib/emoji.js'

const MAX = 12

export default function ThrowablesSection({ board, patchBoard }) {
  const id = useId()
  const setting = useSetting(patchBoard)
  const enabled = Boolean(board.throwables?.enabled)
  const emojis = board.throwables?.emojis?.length ? board.throwables.emojis : [...DEFAULT_THROW_EMOJIS]
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const save = (patch) => setting.save({ throwables: { enabled, emojis, ...patch } })

  async function add(e) {
    e.preventDefault()
    const value = text.trim()
    if (!value) { setProblem('Type or paste one emoji.'); return }
    if (!isSingleEmoji(value)) { setProblem('That is not a single emoji. Use exactly one.'); return }
    if (emojis.includes(value)) { setProblem('That emoji is already in the list.'); return }
    if (emojis.length >= MAX) { setProblem(`The list holds at most ${MAX} emoji. Remove one first.`); return }
    setProblem('')
    if (await save({ emojis: [...emojis, value] })) setText('')
  }

  return (
    <Section title="Throw emoji">
      <Switch
        label="Allow throwing"
        desc="Participants can throw these at notes. Nothing is saved, and you can turn it off any time."
        checked={enabled}
        disabled={setting.busy}
        onChange={(next) => save({ enabled: next })}
      />
      <div className="bd-set-item">
        <p className="bd-set-label" id={`${id}-l`}>Emoji people can throw ({emojis.length} of {MAX})</p>
        <ul className="bd-emoji-list" aria-labelledby={`${id}-l`}>
          {emojis.map((e) => (
            <li key={e} className="bd-emoji-chip">
              <span className="bd-emoji-glyph" aria-hidden="true">{e}</span>
              <button
                type="button"
                className="bd-emoji-remove"
                aria-label={`Remove ${e}`}
                disabled={setting.busy || emojis.length <= 1}
                onClick={() => save({ emojis: emojis.filter((x) => x !== e) })}
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
        {emojis.length <= 1 && <p className="bd-set-hint">At least one emoji must stay in the list.</p>}
        <form className="bd-tc-customrow" onSubmit={add} noValidate>
          <div className="bd-grow-field">
            <label className="bd-set-label" htmlFor={`${id}-a`}>Add emoji</label>
            <input
              id={`${id}-a`}
              className="bd-sinput"
              type="text"
              autoComplete="off"
              placeholder="Paste or type one emoji"
              value={text}
              disabled={setting.busy}
              aria-invalid={problem ? 'true' : undefined}
              aria-describedby={`${id}-e`}
              onChange={(e) => { setText(e.target.value); setProblem('') }}
            />
          </div>
          <button type="submit" className="bd-sbtn is-primary" disabled={setting.busy || !text.trim()}>Add</button>
        </form>
        <p id={`${id}-e`} className="bd-set-error" role="alert">{problem}</p>
        <div className="bd-set-actions">
          <button type="button" className="bd-sbtn" disabled={setting.busy} onClick={() => { setProblem(''); save({ emojis: [...DEFAULT_THROW_EMOJIS] }) }}>Reset to defaults</button>
        </div>
        <SaveNote setting={setting} />
      </div>
    </Section>
  )
}
