import { Button } from '@/components/button'
import { Loader } from '@/components/loader'
import { useTelemetrySetting } from '@/data/insights'
import { SettingRow, SettingSection } from './setting-section'

/**
 * Gives each profile independent control over outbound activity reports.
 */
export function PrivacySettings() {
  const { setting, change } = useTelemetrySetting()
  if (setting.isPending) {
    return <Loader size="md" label="Loading privacy settings…" />
  }
  if (!setting.data) {
    return <Button size="sm" onClick={() => void setting.refetch()}>Retry loading privacy settings</Button>
  }
  const { enabled } = setting.data

  return <SettingSection title="Usage sharing">
    <SettingRow label="Share usage metrics" description="Help me improve my agent loop by sharing daily summaries. Your messages and detailed activity stay on your server.">
      <Button size="sm" disabled={change.isPending}
        onClick={() => change.mutate(!enabled)}>
        {enabled ? 'Stop sharing usage' : 'Share usage'}
      </Button>
    </SettingRow>
  </SettingSection>
}
