'use client'
import { toolAllowed, NOTES_CLOSED } from '../lib/clientRules.js'
import { SelectIcon, NoteIcon, TextIcon, ShapeIcon, ConnectorIcon, FrameIcon, ImageIcon } from './icons.jsx'

export const TOOLS = [
  { id: 'select', label: 'Select', key: 'V', Icon: SelectIcon },
  { id: 'note', label: 'Sticky note', key: 'N', Icon: NoteIcon },
  { id: 'text', label: 'Text', key: 'T', Icon: TextIcon },
  { id: 'shape', label: 'Shape', key: 'S', Icon: ShapeIcon },
  { id: 'connector', label: 'Connector', key: 'C', Icon: ConnectorIcon },
  { id: 'frame', label: 'Frame', key: 'F', Icon: FrameIcon },
  { id: 'image', label: 'Image', key: 'I', Icon: ImageIcon },
]

// Left rail on desktop, bottom bar on phones (CSS). `disabled` leaves only Select usable (locked boards); `closed` does
// the same while a retro stage is closed for notes; tools the board type cannot hold are not shown.
export default function Toolbar({ tool, onTool, disabled, closed = false, type }) {
  return (
    <nav className="bd-rail" aria-label="Tools">
      {TOOLS.filter((t) => toolAllowed(type, t.id)).map(({ id, label, key, Icon }) => {
        const off = (disabled || closed) && id !== 'select'
        return (
          <button
            key={id}
            type="button"
            className={`bd-tool${tool === id ? ' is-active' : ''}`}
            aria-label={label}
            aria-pressed={tool === id}
            title={off && closed && !disabled ? NOTES_CLOSED : `${label} (${key})`}
            disabled={off}
            onClick={() => onTool(id)}
          >
            <Icon />
          </button>
        )
      })}
    </nav>
  )
}
