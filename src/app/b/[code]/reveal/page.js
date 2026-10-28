import { notFound } from 'next/navigation'
import Reveal from '../../../../ui/Reveal.jsx'
import { isCode } from '../../../../lib/ids.js'
import { BOARD_ROBOTS } from '../../../../lib/meta.js'

// Like the board page: the URL holds the access code, so it stays out of search indexes, and there is no store lookup here
// (that would be an unmetered "does this code exist" oracle). The client asks the metered API.
export const metadata = { robots: BOARD_ROBOTS }

export default async function RevealPage({ params }) {
  const { code } = await params
  if (!isCode(code)) notFound()
  return <Reveal code={code} />
}
