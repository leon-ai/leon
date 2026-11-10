import { lazy, Suspense, useState } from 'react'

import { Button } from '@/components/button'
import { Loader } from '@/components/loader'
import { Dropdown } from '@/components/dropdown'
import { CatalogList } from '@/components/catalog-details/catalog-list'
import { useSkillCatalog, useSkillManagement, type SkillCatalogEntry, type SkillAction } from '@/data/skill-catalog'

const CatalogDetails = lazy(() => import('@/components/catalog-details/catalog-details'))

/**
 * Keeps native and agent skill formats visible while sharing catalog controls.
 */
export default function SkillsSettings() {
  const catalog = useSkillCatalog()
  const management = useSkillManagement()
  const [details, setDetails] = useState<SkillCatalogEntry>()
  const act = (entry: SkillCatalogEntry, action: SkillAction): void => {
    void management.mutateAsync({ id: entry.id, action }).catch(() => undefined)
  }

  return <>
    <CatalogList category="skills" entries={catalog.data?.skills ?? []} loading={catalog.isPending} error={catalog.isError}
      onRetry={() => void catalog.refetch()} onDetails={setDetails}
      state={(entry) => `${!entry.installed ? 'Not installed' : entry.enabled ? 'Enabled' : 'Disabled'} · ${entry.version}`}
      actions={(entry) => !entry.installed ? <Button size="sm" variant="secondary" disabled={management.isPending}
        onClick={() => act(entry, 'install')}>Add</Button> : <Dropdown disabled={management.isPending} contentLabel={`${entry.name} options`} items={[
          { label: entry.enabled ? 'Disable' : 'Enable', iconName: entry.enabled ? 'close-circle-line' : 'check-line',
            onSelect: () => act(entry, entry.enabled ? 'disable' : 'enable') },
          ...(!entry.owned && entry.distribution === 'extension' ? [{ label: 'Remove skill', iconName: 'delete-bin-line',
            onSelect: () => act(entry, 'remove') }] : [])
        ]}>{(open, id) => <Button size="sm" iconName="more" tooltipMessage="Skill options"
          ariaExpanded={open} ariaControls={id} ariaHasPopup="menu" />}</Dropdown>} />
    {details && <Suspense fallback={<Loader size="sm" label="Opening skill…" />}>
      <CatalogDetails key={details.id} entry={details} category="skills" onClose={() => setDetails(undefined)} />
    </Suspense>}
  </>
}
