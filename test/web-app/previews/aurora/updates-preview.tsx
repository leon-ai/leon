import { useState } from 'react'

import { Button } from '@/components/button'
import { UpdateDialog } from '@/components/update-dialog/update-dialog'
import { DesktopSetupView, SetupPhase, type SetupState } from '@/components/desktop-setup/desktop-setup'
import { UpdatePhase, UpdateStage, type UpdateState, type DesktopUpdateSnapshot } from '../../../../bridges/runtime/contracts/updates'
import { UPDATE_FIXTURE } from '../../../fixtures/updates'

const STAGES: string[] = Object.values(UpdateStage)
const DESKTOP_PHASES: DesktopUpdateSnapshot['phase'][] = ['idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'failed']
const noop = (): void => undefined

/**
 * Uses production views with owner-controlled states, without installers,
 * background timers, credentials or release-network requests in the gallery.
 */
export default function UpdatesPreview() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('core')
  const [stage, setStage] = useState('available')
  const [desktopPhase, setDesktopPhase] = useState<DesktopUpdateSnapshot['phase']>('available')
  const [setupPhase, setSetupPhase] = useState(SetupPhase.Running)
  const [details, setDetails] = useState(true)
  const [external, setExternal] = useState(false)
  const [supported, setSupported] = useState(true)
  const [includeCore, setIncludeCore] = useState(false)
  const running = STAGES.includes(stage) || stage === 'reconnecting'
  const current = stage === 'failed' ? 1 : STAGES.indexOf(stage)
  const state: UpdateState | null = stage === 'available' ? null : {
    id: 'preview', phase: stage === 'failed' ? UpdatePhase.Failed : stage === 'completed' ? UpdatePhase.Completed : UpdatePhase.Installing,
    version: UPDATE_FIXTURE.check!.release!.version, error: stage === 'failed' ? 'I could not verify this archive. My previous version is still available.' : null,
    steps: STAGES.slice(0, stage === 'completed' ? STAGES.length : current + 1).map((id, index) => ({
      id, status: stage === 'completed' || index < current ? 'completed' : stage === 'failed' ? 'failed' : 'running',
      downloadedBytes: id === 'downloading' ? (stage === 'downloading' ? 64 : 128) * 1_024 ** 2 : null,
      totalBytes: id === 'downloading' ? 128 * 1_024 ** 2 : null,
      details: details && id === 'preparing' ? ['My configuration is up to date.', 'Applying pending profile migrations.', 'My skills settings are ready.'] : []
    }))
  }
  const desktop: DesktopUpdateSnapshot = { supported, currentVersion: '0.1.0', phase: desktopPhase,
    version: desktopPhase === 'idle' || desktopPhase === 'checking' ? null : '0.1.1', releaseNotes: 'Native clipboard improvements and Electron updates.',
    progress: desktopPhase === 'downloading' ? { downloadedBytes: 32 * 1_024 ** 2, totalBytes: 128 * 1_024 ** 2 } : null,
    error: desktopPhase === 'failed' ? 'I could not verify my desktop update. Check again to retry.' : null, reason: supported ? null : 'Automatic desktop updates are unavailable for this installation.' }
  const setup: SetupState = { phase: setupPhase, external, service: false, logAvailable: true,
    error: setupPhase === SetupPhase.Failed ? 'I could not finish setup. My completed downloads and profiles are preserved.' : null,
    steps: [{ id: 'download', label: 'Downloading my Core', phase: setupPhase === SetupPhase.Running ? SetupPhase.Running : setupPhase,
      value: 64 * 1_024 ** 2, total: 128 * 1_024 ** 2, details: ['My platform archive is selected.', 'My download can resume after an interruption.'] }] }

  return <div className="demo-stack">
    <h2>Updates</h2>
    <label>Preview <select aria-label="Update preview" value={view} onChange={(event) => {
      setOpen(false)
      setView(event.target.value)
    }}>
      <option value="core">Browser update</option><option value="desktop">Desktop update</option><option value="setup">Core setup</option>
    </select></label>
    <p>{view === 'core' ? 'Update Leon from a browser.' : view === 'desktop'
      ? 'One update action prepares the available server and app updates.'
      : 'First-time Core installation and background startup.'}</p>
    {(view === 'core' || view === 'desktop' && includeCore) && <div className="demo-controls">
      <label>Core update state <select aria-label="Core update state" value={stage} onChange={(event) => setStage(event.target.value)}>
        {['available', ...STAGES, 'reconnecting', 'completed', 'failed'].map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label><input type="checkbox" checked={details} onChange={(event) => setDetails(event.target.checked)} />Include step details</label>
    </div>}
    {view === 'desktop' && <div className="demo-controls">
      <label>Desktop update state <select aria-label="Desktop update state" value={desktopPhase} onChange={(event) => setDesktopPhase(event.target.value as DesktopUpdateSnapshot['phase'])}>
        {DESKTOP_PHASES.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label><input type="checkbox" checked={supported} onChange={(event) => setSupported(event.target.checked)} />Automatic desktop updates supported</label>
      <label><input type="checkbox" checked={includeCore} onChange={(event) => setIncludeCore(event.target.checked)} />Server update also available</label>
    </div>}
    {view !== 'setup' && <Button variant="primary" onClick={() => setOpen(true)}>
      Preview Leon update
    </Button>}
    {view !== 'setup' && <UpdateDialog key={view} check={view === 'core' || includeCore ? UPDATE_FIXTURE.check! : null}
      state={view === 'core' || includeCore ? state : null} desktop={view === 'desktop' ? desktop : null}
      open={open} reconnecting={(view === 'core' || includeCore) && stage === 'reconnecting'}
      updating={(view === 'core' || includeCore) && running}
      onClose={() => setOpen(false)} onAfterClose={noop} onUpdate={() => {
        if (view === 'core' || includeCore) {
          setStage('downloading')
        } else {
          setDesktopPhase(desktopPhase === 'ready' ? 'installing' : 'downloading')
        }
      }}>
      {(view === 'core' || includeCore) && running && <label className="update-preview-control">Preview controls <select aria-label="Core update state" value={stage} onChange={(event) => setStage(event.target.value)}>
        {['available', ...STAGES, 'reconnecting', 'completed', 'failed'].map((value) => <option key={value}>{value}</option>)}
      </select></label>}
    </UpdateDialog>}
    {view === 'setup' && <>
    <h2>Core setup</h2>
    <label>Setup state <select aria-label="Setup state" value={setupPhase} onChange={(event) => setSetupPhase(event.target.value as SetupPhase)}>
      {Object.values(SetupPhase).map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <label><input type="checkbox" checked={external} onChange={(event) => {
      setExternal(event.target.checked)
      setSetupPhase(SetupPhase.Complete)
    }} />Connect to an already running Core</label>
    <DesktopSetupView data={setup} pending={false} choosing={false} onStart={() => setSetupPhase(SetupPhase.Running)}
      onChoose={noop} onCancel={() => setSetupPhase(SetupPhase.Cancelled)} onConnect={noop} onStartup={noop}
      onLogs={noop} onStop={() => setSetupPhase(SetupPhase.Idle)} />
    </>}
  </div>
}
