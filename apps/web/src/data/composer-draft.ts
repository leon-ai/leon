import { useLayoutEffect, useRef, useState } from 'react'

import { useProfile } from './profile'
import { requestErrors } from './request-errors'

const DRAFT_STORAGE_PREFIX = 'leon.web-app.composer-draft.'

function readDraft(key: string | undefined): string {
  if (!key) {
    return ''
  }

  try {
    return window.sessionStorage.getItem(key) ?? ''
  } catch {
    // Restricted browser storage must not prevent drafting.
    return ''
  }
}

/**
 * Retains only the active draft in React. Tab-scoped storage keeps unsent text
 * across navigation and refresh without saving on the typing hot path.
 */
export function useComposerDraft(sessionId?: string): [string, (value: string) => void, number] {
  const profile = useProfile()
  const storageKey = profile
    ? `${DRAFT_STORAGE_PREFIX}${JSON.stringify([profile, sessionId ?? null])}`
    : undefined
  const [query, setQuery] = useState(() => readDraft(storageKey))
  const [restoration, setRestoration] = useState(0)
  const draftRef = useRef({ key: storageKey, value: query, edited: false })

  useLayoutEffect(() => {
    const previous = draftRef.current
    if (previous.key !== storageKey) {
      // Identity can resolve after typing begins. New local text takes priority
      // over a stored draft, but never carries between authenticated profiles.
      const keepLocal = previous.key === undefined && previous.edited
      const value = keepLocal ? previous.value : readDraft(storageKey)
      draftRef.current = { key: storageKey, value, edited: keepLocal }
      setQuery(value)
      if (!keepLocal) {
        setRestoration((revision) => revision + 1)
      }
    }

    const draft = draftRef.current
    if (!draft.key) {
      return
    }
    const key = draft.key

    function save(): void {
      if (!draft.edited) {
        return
      }

      try {
        if (draft.value === '') {
          window.sessionStorage.removeItem(key)
        } else {
          window.sessionStorage.setItem(key, draft.value)
        }
        draft.edited = false
      } catch {
        requestErrors.report(new Error('I could not save this draft in this tab. Browser storage may be unavailable or full.'), {
          errorTitle: 'Draft was not saved', profile
        })
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        save()
      }
    }

    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return (): void => {
      save()
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [storageKey, profile])

  function updateQuery(value: string): void {
    if (draftRef.current.value !== value) {
      draftRef.current.value = value
      draftRef.current.edited = true
    }
    setQuery(value)
  }

  return [query, updateQuery, restoration]
}
