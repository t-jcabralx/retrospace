'use client'
import { Component } from 'react'
import PanelLinks from './PanelLinks.jsx'

// A render error inside the board (an item that cannot be drawn, say) must not leave everyone with a white page: it
// shows a panel with a way to reload or leave instead.
export default class BoardErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('retrospace: the board failed to draw:', error?.message)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="bd-panel-screen">
        <div className="bd-panel" role="alert">
          <h1>This board hit a problem</h1>
          <p>Something on the board could not be shown. Reloading usually fixes it.</p>
          <p><button type="button" className="bd-btn" onClick={() => window.location.reload()}>Reload the board</button></p>
          <PanelLinks />
        </div>
      </main>
    )
  }
}
