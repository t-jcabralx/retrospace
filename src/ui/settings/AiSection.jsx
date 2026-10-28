'use client'
import { useEffect, useId, useState } from 'react'
import { Section, Switch, SaveNote, ConfirmStep } from './controls.jsx'
import { useSetting } from './useSetting.js'

export const AI_NOTICE = 'The text of the board’s notes and cards is sent to Anthropic to write summaries and suggest themes. Participant names, avatars and ids are not sent, but anything people type may mention names. This includes an automatic summary when the board is closed. You review every summary before it is shared.'
const refocus = (id) => setTimeout(() => document.getElementById(`${id}-b`)?.focus(), 0) // a confirm step takes focus with it when it closes

// One switch backed by one `ai` setting.
function AiToggle({ id, patchBoard, label, desc, checked, field, disabled, children }) {
  const setting = useSetting(patchBoard)
  return (
    <Switch id={id} label={label} desc={desc} checked={checked} disabled={setting.busy || disabled} onChange={(next) => setting.save({ ai: { [field]: next } })}>
      {children}
      <SaveNote setting={setting} />
    </Switch>
  )
}

// Owner settings for AI summaries. Turning AI on the first time shows what is sent and asks for an explicit "I understand".
export default function AiSection({ board, patchBoard, info, focusOnMount = false }) {
  const id = useId()
  const master = useSetting(patchBoard)
  const [asking, setAsking] = useState(false)
  const ai = board.ai ?? {}
  const on = Boolean(ai.enabled)
  const available = Boolean(info?.configured)
  const mainId = `${id}-main`

  useEffect(() => {
    if (!focusOnMount) return undefined
    const t = setTimeout(() => {
      const el = document.getElementById(`${mainId}-b`)
      el?.scrollIntoView({ block: 'center' })
      el?.focus()
    }, 50)
    return () => clearTimeout(t)
  }, [focusOnMount, mainId])

  async function turn(next) {
    setAsking(false)
    if (next && !ai.ackAt) { master.clear(); setAsking(true); return }
    await master.save({ ai: { enabled: next } })
    refocus(mainId)
  }
  async function acknowledge() {
    setAsking(false)
    await master.save({ ai: { enabled: true, ack: true } })
    refocus(mainId)
  }

  return (
    <Section title="AI summaries" hint={available ? `Optional. Written with ${info.model}.` : undefined}>
      {!available && <p className="bd-set-hint">Not available on this server. You can still write a summary yourself.</p>}
      <Switch
        id={mainId}
        label="AI summaries"
        desc={on ? AI_NOTICE : 'Off. Nothing from this board is sent anywhere.'}
        checked={on}
        disabled={master.busy || (!available && !on)}
        onChange={turn}
      >
        {asking && (
          <ConfirmStep
            message={AI_NOTICE}
            confirmLabel="I understand"
            tone="primary"
            onConfirm={acknowledge}
            onCancel={() => { setAsking(false); refocus(mainId) }}
          />
        )}
        <SaveNote setting={master} />
      </Switch>
      <AiToggle
        id={`${id}-auto`} patchBoard={patchBoard} field="autoSummary" checked={Boolean(ai.autoSummary)} disabled={!on}
        label="Write a summary automatically when the board is closed"
        desc="A draft appears in the Summary panel for you to review. Only you can see it."
      />
      <AiToggle
        id={`${id}-share`} patchBoard={patchBoard} field="autoShare" checked={Boolean(ai.autoShare)} disabled={!on}
        label="Share automatically"
        desc="Warning: automatic summaries then go out to everyone without your review. They are labelled AI-generated."
      />
    </Section>
  )
}
