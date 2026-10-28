import { notFound } from 'next/navigation'
import PrintView from '../../../../ui/PrintView.jsx'
import { isCode } from '../../../../lib/ids.js'
import { BOARD_ROBOTS } from '../../../../lib/meta.js'

export const metadata = { title: 'Print board', robots: BOARD_ROBOTS }

// Like the board page: no store lookup here (that would be an unmetered "does this code exist" oracle). The document is drawn
// in the browser from the board API's answer, which applies every access rule (revoked, passcode, removed) and is metered.
export default async function PrintPage({ params }) {
  const { code } = await params
  if (!isCode(code)) notFound()
  return <PrintView code={code} />
}
