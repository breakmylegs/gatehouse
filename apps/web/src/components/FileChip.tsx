import { extensionOf } from "../lib/attachments"
import { Icon } from "./Icon"

/** One attached file as an icon with its kind in the corner; its name is the tooltip and what a screen reader says. */
export function FileChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const ext = extensionOf(name)
  return (
    <span className="file-chip" title={name}>
      <span role="img" aria-label={`File ${name}`} className="file-chip-icon">
        <Icon name="files" size={18} />
        {ext ? (
          <span className="file-chip-ext" aria-hidden="true">
            {ext}
          </span>
        ) : null}
      </span>
      {onRemove ? (
        <button
          type="button"
          className="pic-remove"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <Icon name="close" size={12} />
        </button>
      ) : null}
    </span>
  )
}
