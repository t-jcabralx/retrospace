import { notFound } from 'next/navigation'
import BoardScreen from '../../../ui/BoardScreen.jsx'
import { isCode } from '../../../lib/ids.js'
import { BOARD_ROBOTS } from '../../../lib/meta.js'

// The URL holds the access code: keep it out of search indexes. Static metadata, so still no store lookup here.
export const metadata = { robots: BOARD_ROBOTS }

// Deliberately no store lookup: answering 404 vs 200 here would be an unmetered "does this code exist" oracle. The
// client asks the metered API and shows its own "Board not found" panel for a missing board.
// ?view=1 (the reveal page's "See the whole board") opens the board for looking only: no name to choose, nothing to edit.
export default async function BoardPage({ params, searchParams }) {
  const { code } = await params
  if (!isCode(code)) notFound()
  const { view } = await searchParams
  return <BoardScreen code={code} viewOnly={view === '1'} />
}
