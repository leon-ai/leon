import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { InputDropdown } from '@/components/input-dropdown/input-dropdown'
import { Icon } from '@/components/icon'
import { Button } from '@/components/button'
import { requestAPI } from '@/data/api'
import { useProfile } from '@/data/profile'

const FOLDER_LOADING_DELAY_MS = 300

interface FolderPickerProps {
  onAttach: (path: string) => void
  disabled?: boolean
  initialPath?: string
  label?: string
}

interface FolderListing {
  success: boolean
  directory?: string
  parent?: string
  entries: { name: string, absolutePath: string }[]
  message?: string
}

/**
 * Browses host folders without exposing files or attaching a folder implicitly.
 */
export function FolderPicker({ onAttach, disabled = false, initialPath, label = 'Folder' }: FolderPickerProps) {
  const profile = useProfile()
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const [requestedPath, setRequestedPath] = useState<string | null>(initialPath ?? null)
  const value = requestedPath ?? '~/'
  const [browsing, setBrowsing] = useState(false)
  const listing = useQuery({
    queryKey: ['folder-listing', profile, value], enabled: browsing && Boolean(profile), gcTime: 0,
    meta: { profile, errorTitle: 'I couldn’t browse this folder' },
    queryFn: async ({ signal }) => {
      const result = await requestAPI<FolderListing>('file-system/list', {
        method: 'POST', body: JSON.stringify({ value, folders_only: true }), signal
      })
      // Older server processes return entries without the navigation metadata.
      // Report that mismatch rather than treating two missing paths as the root.
      if (result.success && (!result.directory || !result.parent)) {
        throw new Error('I need the server to be rebuilt and restarted before I can browse folders.')
      }

      return result
    }
  })

  return <InputDropdown fieldRef={input} label={label} value={requestedPath ?? listing.data?.directory ?? value} placeholder="Browse folders…" disabled={disabled}
    onChange={setRequestedPath} content={(close, open) => <FolderResults open={open} onOpenChange={setBrowsing}
      path={value} listing={listing} onNavigate={(path) => {
        setRequestedPath(path)
        // Navigation replaces the clicked option; keep keyboard browsing anchored.
        input.current?.focus()
      }} onAttach={() => {
        if (listing.data?.success && listing.data.directory) {
          setRequestedPath(listing.data.directory)
          onAttach(listing.data.directory)
          close()
        }
      }} />} />
}

// Only the mounted popup enables queries, so typing elsewhere never probes disk.
function FolderResults({ open, onOpenChange, path, listing, onNavigate, onAttach }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  path: string
  listing: ReturnType<typeof useQuery<FolderListing, Error>>
  onNavigate: (path: string) => void
  onAttach: () => void
}) {
  useEffect(() => {
    onOpenChange(open)

    return () => onOpenChange(false)
  }, [open, onOpenChange])
  const data = listing.data

  return <>
    <div className="input-dropdown-list">
      {data?.success && <button type="button" className="dropdown-item" disabled={!data.parent || data.parent === data.directory}
        onClick={() => data.parent && onNavigate(data.parent)}>
        <Icon name="corner-left-up-line" className="dropdown-item-icon" /><span>..</span>
      </button>}
      {listing.isFetching ? open && <FolderLoading key={path} />
        : listing.isError || data?.success === false ? <p role="alert" className="input-dropdown-message">{listing.error?.message ?? data?.message}</p>
          : data?.entries.map((folder) => <button type="button" className="dropdown-item" key={folder.absolutePath}
            onClick={() => onNavigate(folder.absolutePath)}>
            <Icon name="folder-line" className="dropdown-item-icon" /><span className="dropdown-item-label">{folder.name}</span>
          </button>)}
    </div>
    <footer className="input-dropdown-footer"><Button variant="secondary" disabled={!data?.success || !data.directory || listing.isFetching}
      onClick={onAttach}>Attach this folder</Button></footer>
  </>
}

// Each lookup owns its delay; navigating, completing or closing cancels the notice.
function FolderLoading() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), FOLDER_LOADING_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [])

  return visible ? <p className="input-dropdown-message">Loading folders…</p> : null
}
