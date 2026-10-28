// A retro action item: what, who, by when. A missing owner or due date shows a chip so nothing slips through.
const STATUS = { open: 'Open', doing: 'Doing', done: 'Done' }
const PRIORITY = { low: 'Low priority', normal: 'Normal priority', high: 'High priority' }

export default function ActionCard({ item, editing }) {
  const d = item.data
  return (
    <div className={`rt-card is-${d.status ?? 'open'}`}>
      {!editing && <p className="rt-card-text">{d.action}</p>}
      <div className="rt-card-meta">
        <span className="rt-chip">{STATUS[d.status] ?? 'Open'}</span>
        {d.priority && d.priority !== 'normal' && <span className={`rt-chip is-${d.priority}`}>{PRIORITY[d.priority]}</span>}
        {d.owner ? <span className="rt-chip">{d.owner}</span> : <span className="rt-chip is-warn">Needs owner</span>}
        {d.due ? <span className="rt-chip">Due {d.due}</span> : <span className="rt-chip is-warn">Needs due date</span>}
      </div>
    </div>
  )
}
