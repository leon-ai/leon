import { useContext } from 'react'
import { ConnectionSetupWidget } from '../../../../../aurora/src/v2/widgets/connection-setup'
import type { ConnectionSetupDescriptor } from '../../../../../aurora/src/contracts/connection-setup'
import { ConversationDetailsContext } from '@/data/conversation-details'
import { useConnectionSetup } from '@/data/connection-setup'
import { Icon } from '@/components/icon'
import { PackageIcon } from '@/components/package-icon/package-icon'
import { CopyButton } from '@/components/copy-button'
import { Tooltip } from '@/components/tooltip'
import type { ConnectionAuthorizationPopup } from '@/data/connection-authorization'

/**
 * Binds a trusted connection card to its actual authenticated conversation,
 * never to a session or request URL supplied inside a widget tree.
 */
export default function ConnectionSetupCard({ connection, initialAuthorization }: { connection: ConnectionSetupDescriptor, initialAuthorization?: ConnectionAuthorizationPopup }) {
  const owner = useContext(ConversationDetailsContext)
  const setup = useConnectionSetup(owner?.sessionId ?? '', connection.provider, initialAuthorization)

  return <ConnectionSetupWidget title={connection.name ? `Set up ${connection.name}` : 'Connection setup'}
    view={setup.view} loading={setup.loading} busy={setup.busy} error={setup.error}
    icon={<PackageIcon logoUrl={connection.logoUrl} iconName={connection.iconName ?? 'plug-line'} />} statusIcon={<Icon name="check-fill" />}
    onRefresh={setup.refresh} onAction={setup.act}
    renderCopyButton={(item) => <CopyButton text={item.value} label={item.copyLabel} size="sm" />}
    renderLink={(link) => <Tooltip message={link.href} multiline blurOnClick={false}>
      <a href={link.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link.label}</a>
    </Tooltip>} />
}
