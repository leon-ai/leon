import { Button } from '@/components/button'
import type { CatalogPresentation } from '../../../../../server/src/core/catalog/types'
import './catalog-details.sass'

/**
 * Maintenance is separate from authorship and remote-provider ownership. The
 * server alone decides which curated entries may carry the official badge.
 */
export function MaintenanceBadge({ entry, onClick }: { entry: CatalogPresentation, onClick: () => void }) {
  if (!entry.maintenance) {
    return null
  }
  const official = entry.maintenance === 'official'

  return <Button size="sm" iconName={official ? 'checkbox-circle' : 'discuss'}
    tooltipMessage={official ? 'Maintained by the Leon team' : 'Maintained by the community'}
    onClick={onClick} />
}
