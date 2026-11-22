import './shortcut.sass'

/**
 * Displays keycaps while the associated control exposes the accessible shortcut.
 */
export function Shortcut({ keys, variant }: { keys: readonly string[], variant?: 'inset' }) {
  return <span className="shortcut" data-variant={variant} aria-hidden="true">
    {keys.map((key, index) => <kbd key={`${key}-${index}`}>{key}</kbd>)}
  </span>
}
