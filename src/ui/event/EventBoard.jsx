'use client'
import EventScreen from './EventScreen.jsx'
import { useServerWheel } from './hooks.js'

// An Event board stored on our server, shown live to everyone who has the code.
export default function EventBoard({ ctl }) {
  const api = useServerWheel(ctl)
  return <EventScreen api={api} />
}
