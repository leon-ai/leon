import { lazy, Suspense, useState, useEffect } from 'react'
import { Button } from '@/components/button'
import { Dialog } from '@/components/dialog'
import { Dropdown } from '@/components/dropdown'
import { Input } from '@/components/input'
import { Loader } from '@/components/loader'
import { CatalogList } from '@/components/catalog-details/catalog-list'
import { useToolCatalog, useToolManagement, type ToolAction, type ToolCatalogEntry } from '@/data/tool-catalog'
import { openConnectionAuthorization, type ConnectionAuthorizationPopup } from '@/data/connection-authorization'

const ConnectionCard = lazy(() => import('@/components/connection-setup/connection-setup'))
const CatalogDetails = lazy(() => import('@/components/catalog-details/catalog-details'))

/**
 * Keeps catalog discovery local. Only Add and Connect initiate installation or
 * third-party requests; a disconnected account never becomes a callable tool.
 */
export default function ToolsConnections() {
  const catalog = useToolCatalog()
  const management = useToolManagement()
  const [adding, setAdding] = useState(false)
  const [connection, setConnection] = useState<ToolCatalogEntry>()
  const [authorization, setAuthorization] = useState<ConnectionAuthorizationPopup>()
  const [removing, setRemoving] = useState<ToolCatalogEntry>()
  const [details, setDetails] = useState<ToolCatalogEntry>()
  const busy = management.install.isPending || management.action.isPending

  useEffect(() => () => authorization?.dispose(), [authorization])

  function connect(entry: ToolCatalogEntry): void {
    let popup: ConnectionAuthorizationPopup | undefined
    if (!entry.connected && entry.connectionMethod === 'oauth') {
      try {
        popup = openConnectionAuthorization(entry.id)
      } catch {
        // The trusted card provides the explicit retry and popup-blocking help.
      }
    }
    setAuthorization(popup)
    setConnection(entry)
  }

  async function act(entry: ToolCatalogEntry, action: ToolAction): Promise<void> {
    try {
      await management.action.mutateAsync({ id: entry.id, action })
      if (action === 'remove') {
        setRemoving(undefined)
      }
    } catch {
      // Shared mutation reporting owns the toast; keep the dialog retryable.
    }
  }

  return <>
    <CatalogList entries={catalog.data?.tools ?? []} category="tools" loading={catalog.isPending} error={catalog.isError}
      onRetry={() => void catalog.refetch()} onDetails={setDetails}
      toolbar={<Button variant="secondary" size="sm" iconName="add-large" onClick={() => setAdding(true)}>Add MCP server</Button>}
      state={(entry) => {
        const state = !entry.installed ? 'Not installed' : !entry.enabled ? 'Disabled' :
          entry.connected ? 'Connected' : entry.canConnect ? 'Not connected' : 'Installed'

        return state + (entry.connected && entry.toolCount !== undefined ? ` · ${entry.toolCount} tools` : '')
      }}
      actions={(entry) => !entry.installed ? <Button size="sm" variant="secondary" disabled={busy}
        loading={management.install.isPending && management.install.variables?.catalogId === entry.catalogId}
        onClick={() => void management.install.mutateAsync({ catalogId: entry.catalogId! }).catch(() => undefined)}>Add</Button> : <>
        {entry.canConnect && <Button size="sm" disabled={busy || !entry.enabled}
          onClick={() => connect(entry)}>{entry.connected ? 'Manage' : 'Connect'}</Button>}
        <Dropdown disabled={busy} contentLabel={`${entry.name} options`} items={[
          { label: entry.enabled ? 'Disable' : 'Enable', iconName: entry.enabled ? 'close-circle-line' : 'check-line',
            onSelect: () => void act(entry, entry.enabled ? 'disable' : 'enable') },
          ...(entry.connected ? [{ label: 'Disconnect', iconName: 'plug-line', onSelect: () => void act(entry, 'disconnect') }] : []),
          ...(entry.kind === 'mcp' || !entry.owned && entry.distribution === 'extension' ? [{
            label: entry.kind === 'mcp' ? 'Remove server' : 'Remove tool', iconName: 'delete-bin-line', variant: 'danger' as const,
            onSelect: () => setRemoving(entry) }] : [])
        ]}>{(open, id) => <Button size="sm" iconName="more" tooltipMessage="Tool options"
          ariaExpanded={open} ariaControls={id} ariaHasPopup="menu" />}</Dropdown>
      </>} />
    <AddServerDialog open={adding} close={() => setAdding(false)} />
    <Dialog title="Connection setup" open={Boolean(connection)} centered onClose={() => {
      setConnection(undefined)
      setAuthorization(undefined)
      void management.refresh()
    }} hideFooter>
      {connection && <Suspense fallback={<Loader size="sm" label="Getting connection setup ready…" />}>
        <ConnectionCard connection={{ provider: connection.id, name: connection.name, iconName: connection.iconName,
          ...(connection.logoUrl ? { logoUrl: connection.logoUrl } : {}) }}
          {...(authorization ? { initialAuthorization: authorization } : {})} />
      </Suspense>}
    </Dialog>
    <Dialog title={removing?.kind === 'mcp' ? 'Remove server?' : 'Remove tool?'} open={Boolean(removing)} centered onClose={() => setRemoving(undefined)}
      actions={removing ? [{ label: busy ? 'Removing…' : removing.kind === 'mcp' ? 'Remove server' : 'Remove tool', variant: 'danger',
        onClick: () => {
          if (!busy) {
            void act(removing, 'remove')
          }
        } }] : []}>
      <p>This removes access from this profile. Native settings are preserved; removing an MCP server also removes its saved sign-in.
        Your conversations and data on the provider’s website stay unchanged.</p>
    </Dialog>
    {details && <Suspense fallback={<Loader size="sm" label="Opening tool…" />}>
      <CatalogDetails key={details.id} entry={details} category="tools" onClose={() => setDetails(undefined)} />
    </Suspense>}
  </>
}

function AddServerDialog({ open, close }: { open: boolean, close: () => void }) {
  const management = useToolManagement()

  return <Dialog title="Add MCP server" open={open} onClose={close} centered hideFooter>
    <form className="tools-settings-form" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget
      const values = new FormData(form)
      void management.install.mutateAsync({ url: String(values.get('url')), name: String(values.get('name')),
        ...(values.get('clientId') ? { clientId: String(values.get('clientId')) } : {}),
        ...(values.get('clientMetadataUrl') ? { clientMetadataUrl: String(values.get('clientMetadataUrl')) } : {})
      }).then(() => {
        form.reset()
        close()
      }).catch(() => undefined)
    }}>
      <p>Only add servers you trust. Their tools can receive information you ask me to work with.</p>
      <label>Name<Input ariaLabel="Name" name="name" required maxLength={80} placeholder="My workspace" /></label>
      <label>Server URL<Input ariaLabel="Server URL" name="url" type="url" required maxLength={2_048} placeholder="https://example.com/mcp" /></label>
      <details><summary>OAuth application settings</summary><p>Only needed if the provider requires a registered application.</p>
        <label>Client ID<Input ariaLabel="Client ID" name="clientId" maxLength={256} /></label>
        <label>Client metadata URL<Input ariaLabel="Client metadata URL" name="clientMetadataUrl" type="url" maxLength={2_048} /></label>
      </details>
      <Button variant="primary" type="submit" loading={management.install.isPending}>Add server</Button>
    </form>
  </Dialog>
}
