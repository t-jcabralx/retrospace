'use client'
// Retro boards (owner): which stages run, in what order, how long each lasts, and the limits. One Save sends it all.
import { useEffect, useId, useState } from 'react'
import { Section, SaveNote } from './controls.jsx'
import { useSetting } from './useSetting.js'
import { defaultRetro } from '../../lib/retro.js'

const toMin = (ms) => (ms == null ? '' : String(Math.round((ms / 60_000) * 100) / 100))
const fromMin = (v) => (v === '' ? null : Math.round(Number(v) * 60_000))

export default function StagesSection({ retro, patchBoard }) {
  const id = useId()
  const save = useSetting(patchBoard)
  const fresh = (r) => ({ stages: r.stages.map((s) => ({ ...s, mins: toMin(s.durationMs) })), topN: r.topN, maxActions: r.maxActions, votesPerPerson: r.votesPerPerson })
  const [draft, setDraft] = useState(() => fresh(retro))
  const [problem, setProblem] = useState('')
  useEffect(() => { setDraft(fresh(retro)) }, [retro.stages, retro.topN, retro.maxActions, retro.votesPerPerson]) // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (i, patch) => { setProblem(''); setDraft((d) => ({ ...d, stages: d.stages.map((s, n) => (n === i ? { ...s, ...patch } : s)) })) }
  const move = (i, by) => setDraft((d) => {
    const stages = [...d.stages]
    ;[stages[i], stages[i + by]] = [stages[i + by], stages[i]]
    return { ...d, stages }
  })
  const num = (k) => (e) => { setProblem(''); setDraft((d) => ({ ...d, [k]: e.target.value === '' ? '' : Number(e.target.value) })) }

  async function submit(e) {
    e.preventDefault()
    const stages = draft.stages.map((s) => ({ key: s.key, label: s.label, enabled: s.enabled, durationMs: s.mins === '' ? null : fromMin(s.mins) }))
    if (stages.filter((s) => s.enabled).length < 2) return setProblem('Keep at least two stages on.')
    if (stages.some((s) => s.durationMs !== null && (!Number.isFinite(s.durationMs) || s.durationMs < 10_000 || s.durationMs > 240 * 60_000))) return setProblem('A stage lasts 10 seconds to 4 hours, or has no timer.')
    if (stages.some((s) => !s.label.trim() || s.label.length > 40)) return setProblem('Stage names are 1-40 characters.')
    await save.save({ retro: { type: 'config', stages, topN: draft.topN, maxActions: draft.maxActions, votesPerPerson: draft.votesPerPerson } })
  }
  async function reset() {
    const d = defaultRetro()
    await save.save({ retro: { type: 'config', stages: d.stages, topN: d.topN, maxActions: d.maxActions, votesPerPerson: d.votesPerPerson } })
  }

  return (
    <Section title="Stages" hint="Switch stages off to skip them, reorder them, and set how long each lasts (empty means no timer).">
      <form onSubmit={submit}>
        <ol className="rt-stagelist">
          {draft.stages.map((s, i) => (
            <li key={s.key} className="rt-stagerow">
              <input type="checkbox" id={`${id}-e${i}`} checked={s.enabled} onChange={(e) => edit(i, { enabled: e.target.checked })} aria-label={`${s.label} on`} />
              <input className="bd-sinput" aria-label={`Name of stage ${i + 1}`} maxLength={40} value={s.label} onChange={(e) => edit(i, { label: e.target.value })} />
              <input className="bd-sinput bd-sinput--short" type="number" min="0.17" max="240" step="any" placeholder="No timer" aria-label={`Minutes for ${s.label} (empty: no timer)`} value={s.mins} onChange={(e) => edit(i, { mins: e.target.value })} />
              <button type="button" className="bd-sbtn" aria-label={`Move ${s.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="bd-sbtn" aria-label={`Move ${s.label} down`} disabled={i === draft.stages.length - 1} onClick={() => move(i, 1)}>↓</button>
            </li>
          ))}
        </ol>
        <div className="rt-row">
          <div><label className="rt-label" htmlFor={`${id}t`}>Topics to discuss</label><input id={`${id}t`} className="bd-sinput bd-sinput--short" type="number" min="1" max="10" value={draft.topN} onChange={num('topN')} /></div>
          <div><label className="rt-label" htmlFor={`${id}a`}>Actions allowed</label><input id={`${id}a`} className="bd-sinput bd-sinput--short" type="number" min="1" max="20" value={draft.maxActions} onChange={num('maxActions')} /></div>
          <div><label className="rt-label" htmlFor={`${id}v`}>Votes per person</label><input id={`${id}v`} className="bd-sinput bd-sinput--short" type="number" min="1" max="20" value={draft.votesPerPerson} onChange={num('votesPerPerson')} /></div>
        </div>
        <p className="bd-set-error" role="alert">{problem}</p>
        <div className="bd-set-actions">
          <button type="submit" className="bd-sbtn is-primary" disabled={save.busy}>Save stages</button>
          <button type="button" className="bd-sbtn" disabled={save.busy} onClick={reset}>Reset to defaults</button>
        </div>
        <SaveNote setting={save} />
      </form>
    </Section>
  )
}
