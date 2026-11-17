import type { ReactNode } from 'react'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/button'
import { Callout } from '@/components/callout/callout'
import { LEON_VERSION } from '@/config'
import { Progress } from '../../../../../aurora/src/v2/components/progress'
import type { DesktopUpdateSnapshot, UpdateCheck, UpdateState } from '../../../../../bridges/runtime/contracts/updates'
import { UpdateProgress } from './update-progress'
import { UpdateReleaseNotes } from './update-release-notes'

import './update-dialog.sass'

interface UpdateDialogProps {
  children?: ReactNode
  check: UpdateCheck | null
  open: boolean
  updating: boolean
  reconnecting?: boolean
  progress?: UpdateState['progress']
  state?: UpdateState | null | undefined
  desktop?: DesktopUpdateSnapshot | null | undefined
  onClose: () => void
  onAfterClose: () => void
  onUpdate: () => void
}

/**
 * Presents one Leon release and action. Installation targets are host-owned;
 * technical component versions stay available in the optional details.
 */
export function UpdateDialog({ children, check, open, updating, progress, state,
  desktop, reconnecting, onClose, onAfterClose, onUpdate }: UpdateDialogProps) {
  const release = check?.release
  const nativeAvailable = Boolean(desktop?.supported && desktop.version)
  const nativeBusy = desktop?.phase === 'downloading' || desktop?.phase === 'installing'
  const coreAvailable = Boolean(release && check?.canInstall)
  const busy = updating || desktop?.phase === 'installing'
  const currentVersion = release ? check?.currentVersion : nativeAvailable ? desktop?.currentVersion : check?.currentVersion
  const date = release && new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(release.publishedAt))
  const notes = release ? <>
    <div className="update-release-meta"><time dateTime={release.publishedAt}>{date}</time></div>
    <UpdateReleaseNotes id={`release:${release.tag}`} summary={release.highlights} changelog={release.changelog} />
  </> : desktop?.releaseNotes ? <UpdateReleaseNotes id={`desktop:${desktop.version}`} summary={desktop.releaseNotes} /> : null

  return <Dialog open={open} size="large" className="update-dialog" title={release?.title ?? 'Update Leon'}
    onClose={onClose} onAfterClose={onAfterClose} dismissible={!busy} footer={<>
      <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={busy || !coreAvailable && !nativeAvailable} onClick={onUpdate}>
        {busy ? 'Updating Leon…' : 'Update Leon'}
      </Button>
    </>}>
    {children}
    <section className="update-panel" aria-label="Leon update">
      <p className="update-description">I’ll update the parts of Leon available for this installation and keep your profiles in place.</p>
      <dl className="update-versions">
        <div><dt>Installed</dt><dd>v{currentVersion ?? LEON_VERSION}</dd></div>
        <div><dt>Available</dt><dd>{release ? `v${release.version}` : nativeAvailable ? `v${desktop?.version}` : '—'}</dd></div>
      </dl>
      {check && !check.canInstall && check.reason && <Callout variant="warning">{check.reason}</Callout>}
      {updating && <Callout>I’m updating Leon. You can reopen this page to check progress.</Callout>}
      {reconnecting && <Progress label="Waiting for Leon to reconnect" />}
      {!reconnecting && (state || progress) && <UpdateProgress state={state ?? {
        id: 'active-update', phase: 'installing', version: release?.version ?? '', error: null, progress: progress ?? null
      }} />}
      {desktop?.phase === 'downloading' && <Progress label="Downloading my app update"
        {...(desktop.progress && desktop.progress.totalBytes > 0 ? {
          value: desktop.progress.downloadedBytes, max: desktop.progress.totalBytes
        } : {})} />}
      {desktop?.phase === 'installing' && <Progress label="Restarting Leon" />}
      {desktop?.phase === 'ready' && <p className="update-description">My app update is ready. I’ll restart after any server update finishes.</p>}
      {desktop?.error && <Callout variant="warning">{desktop.error}</Callout>}
      {!release && !nativeAvailable && !nativeBusy && <p className="update-description">I have no update ready to install.</p>}
      {notes && (updating ? <details className="update-release-history"><summary>Release notes</summary>{notes}</details> : notes)}
      {desktop && <details className="update-release-history">
        <summary>Installation details</summary>
        <p>Server: {check ? `v${check.currentVersion}` : 'Unavailable'}. Desktop: v{desktop.currentVersion}.</p>
        {!desktop.supported && desktop.reason && <p>{desktop.reason}</p>}
      </details>}
    </section>
  </Dialog>
}
