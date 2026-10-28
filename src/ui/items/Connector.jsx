import { connectorPath } from '../geometry.js'

// An SVG <g> inside the connector layer. `from`/`to` are the endpoint items at their current (possibly mid-drag) position.
// role="img" with an aria-label; it is focusable so a keyboard user can select it (focus selects) and Delete it.
export default function Connector({ item, from, to, selected, label, onPointerDown, onFocus }) {
  const d = connectorPath(from, to)
  return (
    <g
      className={`bd-connector${selected ? ' is-selected' : ''}`}
      data-id={item.id}
      role="img"
      tabIndex={0}
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
    >
      <path className="bd-connector-hit" d={d} />
      <path className="bd-connector-line" d={d} markerEnd={`url(#${selected ? 'bd-arrow-sel' : 'bd-arrow'})`} />
    </g>
  )
}
