import type { IconDefinition } from './icon-definitions'

/**
 * Paints trusted local artwork without loading icon discovery or host services.
 */
export function IconPaths({ definition }: { definition: IconDefinition }) {
  return definition.map((part, index) => (
    <path key={index} d={part.d} className={part.part ? `icon-part-${part.part}` : undefined}
      fill={part.fill ? 'currentColor' : 'none'} fillOpacity={part.fillOpacity}
      stroke={part.fill ? 'none' : 'currentColor'} />
  ))
}
