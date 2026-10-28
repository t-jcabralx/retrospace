'use client'
import '../ui/board.css'
import PanelLinks from '../ui/PanelLinks.jsx'

// The last resort for any page: a render error shows this instead of a blank screen.
export default function ErrorPage({ reset }) {
  return (
    <main className="bd-panel-screen">
      <div className="bd-panel" role="alert">
        <h1>Something went wrong</h1>
        <p>The page hit a problem. Try again, or head back home.</p>
        <p><button type="button" className="bd-btn" onClick={() => reset()}>Try again</button></p>
        <PanelLinks />
      </div>
    </main>
  )
}
