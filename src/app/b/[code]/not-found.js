import '../../../ui/board.css'
import PanelLinks from '../../../ui/PanelLinks.jsx'

export default function BoardNotFound() {
  return (
    <main className="bd-panel-screen">
      <div className="bd-panel">
        <h1>Board not found</h1>
        <p>This link doesn&apos;t match any board. It may have been mistyped or the board was deleted.</p>
        <PanelLinks />
      </div>
    </main>
  )
}
