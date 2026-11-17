import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { useProfile } from '@/data/profile'
import { useDesktopUpdates } from '@/data/desktop-updates'
import { useUpdates } from '@/data/updates'
import { useToast } from '@/components/toast'
import { SidebarUpdateButton } from './sidebar-update-button'
import { UpdatePhase, type UpdateCheck } from '../../../../../bridges/runtime/contracts/updates'

const UpdateDialog = lazy(() => import('@/components/update-dialog/update-dialog').then((module) => ({ default: module.UpdateDialog })))

/**
 * Connects explicit owner actions to shared update state while keeping checking
 * motion independent of the cloud icon's artwork and the button's label.
 */
export function SidebarUpdateControl() {
  const { query, check, apply } = useUpdates(useProfile())
  const desktop = useDesktopUpdates()
  const { showToast } = useToast()
  const [releaseCheck, setReleaseCheck] = useState<UpdateCheck | null>(null)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [nativeVersion, setNativeVersion] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const installingNative = useRef(false)
  const state = query.data?.state
  const updating = apply.isPending || Boolean(state && [UpdatePhase.Scheduled, UpdatePhase.Installing, UpdatePhase.Restarting].some((phase) => phase === state.phase))

  useEffect(() => {
    if (!updating) {
      return
    }
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      // Browsers own the confirmation copy. The accepted job continues in Core
      // after a tab closes; this handler never cancels or repeats installation.
      event.returnValue = true
    }
    window.addEventListener('beforeunload', beforeUnload)

    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [updating])

  useEffect(() => {
    if (!pending && state && [UpdatePhase.Scheduled, UpdatePhase.Installing, UpdatePhase.Restarting].some((phase) => phase === state.phase)) {
      setPending(state.id)
      return
    }
    if (!pending || state?.id !== pending) {
      return
    }
    if (state.phase === UpdatePhase.Completed && !nativeVersion && !starting) {
      // Refresh the document after confirmation so lazy assets match the new build.
      window.location.reload()
    } else if (state.phase === UpdatePhase.Failed) {
      setPending(null)
      setNativeVersion(null)
      setOpen(false)
      showToast({ type: 'error', title: 'I couldn’t finish updating', description: state.error ?? 'Please try again.' })
    }
  }, [nativeVersion, pending, showToast, starting, state])

  useEffect(() => {
    if (!nativeVersion || starting || updating || installingNative.current) {
      return
    }
    // Keep the accepted server job independent. Native replacement follows its
    // successful receipt, so restarting Electron cannot interrupt preparation.
    if (pending && (state?.id !== pending || state.phase !== UpdatePhase.Completed)) {
      return
    }
    const native = desktop.query.data
    if (native?.phase === 'failed' || native?.version !== nativeVersion) {
      setNativeVersion(null)
      setPending(null)
      showToast({ type: 'error', title: 'I couldn’t finish updating',
        description: native?.error ?? 'My app update changed. Please check again.' })
      return
    }
    if (native.phase === 'ready') {
      installingNative.current = true
      desktop.install.mutate(undefined, { onError: () => {
        installingNative.current = false
        setNativeVersion(null)
        setPending(null)
      } })
    }
  }, [desktop.install, desktop.query.data, nativeVersion, pending, showToast, starting, state, updating])

  async function updateLeon(): Promise<void> {
    if (starting || updating || nativeVersion) {
      return
    }
    setStarting(true)
    try {
      let native = desktop.query.data
      if (native?.supported && native.phase === 'failed') {
        native = await desktop.check.mutateAsync()
      }
      if (native?.supported && native.version) {
        setNativeVersion(native.version)
        if (native.phase === 'available') {
          await desktop.download.mutateAsync()
        }
      }
      if (releaseCheck?.canInstall && releaseCheck.release) {
        const snapshot = await apply.mutateAsync(releaseCheck.release.tag)
        setPending(snapshot.state?.id ?? null)
      }
    } catch {
      // Shared mutation handling reports the error once. A server update that
      // was already accepted remains owned by Core, independent of this view.
      setNativeVersion(null)
    } finally {
      setStarting(false)
    }
  }

  function checkForUpdates(): void {
    // The installed Core snapshot is sufficient to open native update controls
    // even when GitHub discovery for Core is offline or rate limited.
    if (desktop.query.data) {
      setReleaseCheck(query.data?.check ?? null)
      setMounted(true)
      setOpen(true)
    }
    if (desktop.query.data?.supported) {
      desktop.check.mutate()
    }
    check.mutate(undefined, { onError: () => {
      // A cached server offer must not block an independently ready app update
      // when the current server check cannot be completed.
      if (desktop.query.data) {
        setReleaseCheck(null)
      }
    }, onSuccess: (snapshot) => {
      if (snapshot.check && (snapshot.check.release || desktop.query.data)) {
        setReleaseCheck(snapshot.check)
        setMounted(true)
        setOpen(true)
      } else if (snapshot.check) {
        showToast({ type: 'success', title: 'I’m already up to date',
          description: `I’m running v${snapshot.check.currentVersion}, with my latest improvements in place.` })
      }
    } })
  }

  return <>
    <SidebarUpdateButton available={Boolean(query.data?.check?.release || desktop.query.data?.version)} checking={check.isPending || desktop.check.isPending} updating={updating}
      onClick={checkForUpdates} />
    {mounted && <Suspense fallback={null}><UpdateDialog check={releaseCheck} open={open}
      updating={updating || starting || Boolean(nativeVersion)}
      state={pending || updating || releaseCheck?.release?.version === state?.version ? state : null}
      reconnecting={query.isError && updating} desktop={desktop.query.data}
      onClose={() => setOpen(false)} onAfterClose={() => {
        setReleaseCheck(null)
        setMounted(false)
      }} onUpdate={() => void updateLeon()} /></Suspense>}
  </>
}
