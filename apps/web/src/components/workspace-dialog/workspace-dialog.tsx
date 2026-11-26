import { useId, useState, type FormEvent } from 'react'

import { Dialog } from '@/components/dialog'
import { Input } from '@/components/input'
import { Button } from '@/components/button'
import { Callout } from '@/components/callout/callout'
import { FolderPicker } from '@/components/folder-picker/folder-picker'
import { useProfile } from '@/data/profile'
import { useWorkspaceMutation, type Workspace } from '@/data/workspaces'
import { createUUID } from '@/utils/create-uuid'
import { WORKSPACE_COLORS, WORKSPACE_LIMITS, WorkspaceResourceKind,
  type WorkspaceColor, type WorkspaceResource } from '../../../../../bridges/runtime/contracts/workspace'

import './workspace-dialog.sass'

interface WorkspaceDialogProps {
  workspace?: Workspace
  onCreated?: (id: string) => void
  onClose: () => void
}

interface FolderRow {
  id: string
  resource?: WorkspaceResource
}

/**
 * Edits project context while preserving existing resources outside this form.
 * Attaching a folder registers its location without loading its contents.
 */
export function WorkspaceDialog({ workspace, onClose, onCreated }: WorkspaceDialogProps) {
  const profile = useProfile()
  const mutation = useWorkspaceMutation(profile)
  // The parent releases this editor only after the shared dialog finishes closing.
  const [open, setOpen] = useState(true)
  const [name, setName] = useState(workspace?.name ?? '')
  const [brief, setBrief] = useState(workspace?.brief ?? '')
  const [color, setColor] = useState<WorkspaceColor>(() => WORKSPACE_COLORS.some((choice) => choice.id === workspace?.color) ? workspace!.color : 'default')
  const [folders, setFolders] = useState<FolderRow[]>(() => {
    const attached = workspace?.resources.filter((resource) => resource.kind === WorkspaceResourceKind.Folder) ?? []

    return attached.length > 0 ? attached.map((resource) => ({ id: createUUID(), resource }))
      : [{ id: createUUID() }]
  })
  const [confirmRemove, setConfirmRemove] = useState(false)
  const formId = useId()

  function close(): void {
    setOpen(false)
    setConfirmRemove(false)
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (!open) {
      return
    }
    mutation.mutate({ ...(workspace ? { id: workspace.id } : {}), input: {
      name, brief, color,
      // Folder rows replace their attachment; unrelated resource metadata stays intact.
      resources: [
        ...(workspace?.resources.filter((resource) => resource.kind !== WorkspaceResourceKind.Folder) ?? []),
        ...folders.flatMap((folder) => folder.resource ? [folder.resource] : [])
      ]
    } }, { onSuccess: (result) => {
      if (!workspace && result.workspace) {
        onCreated?.(result.workspace.id)
      }
      close()
    } })
  }

  return <Dialog open={open} className="workspace-dialog" title={workspace ? 'Edit workspace' : 'New workspace'}
    onClose={close} onAfterClose={onClose}
    footer={<>
      {workspace && <Button variant="danger" disabled={mutation.isPending} onClick={() => setConfirmRemove(true)}>Remove workspace</Button>}
      <Button variant="secondary" onClick={close}>Cancel</Button>
      <Button variant="primary" type="submit" form={formId} loading={mutation.isPending} disabled={!name.trim()}>Save workspace</Button>
    </>}>
    <form className="workspace-editor" id={formId} onSubmit={submit}>
      {!workspace && <Callout>Workspaces group related sessions, a brief and folders. I use this context to keep my help focused.</Callout>}
      <label>Workspace name<Input autoFocus ariaLabel="Workspace name" placeholder="What you are working on..." required
        maxLength={WORKSPACE_LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Workspace brief<Input multiline ariaLabel="Workspace brief" placeholder="What you are trying to achieve, goals, links, context..."
        maxLength={WORKSPACE_LIMITS.brief} value={brief} onChange={(event) => setBrief(event.target.value)} /></label>
      <fieldset className="workspace-colors"><legend>Color</legend>
        <div className="workspace-color-options">
          {WORKSPACE_COLORS.map((choice) => <Button key={choice.id} size="sm" ariaLabel={choice.label} tooltipMessage={choice.label}
            ariaPressed={color === choice.id} className="workspace-color" onClick={() => setColor(choice.id)}
            icon={<span className="workspace-color-dot" data-workspace-color={choice.id} />} />)}
        </div>
      </fieldset>
      <fieldset className="workspace-folders"><legend>Folders</legend>
        <div className="workspace-folder-list">
          {folders.map((folder, index) => <div className="workspace-folder-row" key={folder.id}>
            <FolderPicker {...(folder.resource ? { initialPath: folder.resource.location } : {})} label={index === 0 ? 'Folder' : `Folder ${index + 1}`}
              onAttach={(location) => {
                setFolders((previous) => previous.map((row) => row.id === folder.id ? {
                  ...row, resource: { kind: WorkspaceResourceKind.Folder, label: '', ...row.resource, location }
                } : row))
              }} />
            {(folders.length > 1 || folder.resource) && <Button iconName="close" ariaLabel={`Remove folder ${index + 1}`}
              onClick={() => setFolders((previous) => previous.length === 1
                ? [{ id: createUUID() }] : previous.filter((row) => row.id !== folder.id))} />}
          </div>)}
          {folders.length < WORKSPACE_LIMITS.folders && <Button className="workspace-add-folder" iconName="add-large"
            onClick={() => setFolders((previous) => previous.length < WORKSPACE_LIMITS.folders
              ? [...previous, { id: createUUID() }] : previous)}>Add folder</Button>}
        </div>
      </fieldset>
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
    </form>
    {workspace && <Dialog open={confirmRemove} title="Remove workspace?" description="Your conversations will return to Recents. Your resources and their files will stay where they are."
      onClose={() => setConfirmRemove(false)} actions={[
        { label: 'Cancel', onClick: () => setConfirmRemove(false) },
        { label: 'Remove workspace', variant: 'danger', onClick: () => mutation.mutate({ id: workspace.id }, { onSuccess: close }) }
      ]} />}
  </Dialog>
}
