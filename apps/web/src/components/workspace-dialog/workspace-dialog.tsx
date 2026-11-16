import { useId, useState, type FormEvent } from 'react'

import { Dialog } from '@/components/dialog'
import { Input } from '@/components/input'
import { Button } from '@/components/button'
import { FolderPicker } from '@/components/folder-picker/folder-picker'
import { useProfile } from '@/data/profile'
import { useWorkspaceMutation, type Workspace } from '@/data/workspaces'
import { WORKSPACE_COLORS, WORKSPACE_LIMITS, WorkspaceResourceKind,
  type WorkspaceColor, type WorkspaceResource } from '../../../../../bridges/runtime/contracts/workspace'

import './workspace-dialog.sass'

interface WorkspaceDialogProps {
  workspace?: Workspace
  onCreated?: (id: string) => void
  onClose: () => void
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
  const [resources, setResources] = useState<WorkspaceResource[]>(workspace?.resources ?? [])
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
      name, brief, resources, color
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
      <fieldset className="workspace-folders"><legend>Folder</legend>
        <FolderPicker disabled={resources.length >= WORKSPACE_LIMITS.resources} onAttach={(location) => {
          setResources((previous) => previous.some((resource) => resource.location === location) ? previous
            : [...previous, { kind: WorkspaceResourceKind.Folder, label: '', location }])
        }} />
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
