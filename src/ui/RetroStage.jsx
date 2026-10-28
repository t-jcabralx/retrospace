'use client'
// The staged workflow band under the top bar of a retro board: header, facilitator bar (owner) and the stage panel.
import { useState } from 'react'
import StageHeader from './StageHeader.jsx'
import FacilitatorBar from './FacilitatorBar.jsx'
import StagePanel from './StagePanel.jsx'
import { useRetro } from './useRetro.js'
import './retro.css'

export default function RetroStage({ ctl, onOpenSettings, onOpenSummary }) {
  const rt = useRetro(ctl)
  const [shown, setShown] = useState(true)
  if (!rt.retro || !rt.stage) return null
  return (
    <section className="rt-band" aria-label="Retro stages">
      <StageHeader ctl={ctl} rt={rt}>
        <button type="button" className="bd-sbtn rt-toggle" aria-expanded={shown} onClick={() => setShown((s) => !s)}>{shown ? 'Hide help' : 'Show help'}</button>
      </StageHeader>
      {ctl.isOwner && <FacilitatorBar rt={rt} onOpenSettings={onOpenSettings} />}
      {shown && <StagePanel ctl={ctl} rt={rt} onOpenSummary={onOpenSummary} />}
    </section>
  )
}
