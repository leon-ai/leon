import { lazy, Suspense, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/button'
import { Dialog } from '@/components/dialog'
import { Loader } from '@/components/loader'
import { ScrollList } from '@/components/scroll-list'
import { Icon } from '@/components/icon'
import { CopyButton } from '@/components/copy-button'
import { useProfile } from '@/data/profile'
import { requestAPI } from '@/data/api'
import { PackageIcon } from '@/components/package-icon/package-icon'
import type { CatalogPresentation, CatalogDocument } from '../../../../../server/src/core/catalog/types'
import type { CatalogContact } from '../../../../../server/src/schemas/catalog-metadata-schemas'

const MarkdownContent = lazy(() => import('@/components/markdown-content/markdown-content').then((module) => ({ default: module.MarkdownContent })))

interface CatalogDetailsProps {
  entry: CatalogPresentation & { id: string, name: string, description: string, iconName: string }
  category: 'tools' | 'skills'
  onClose: () => void
}

function Contact({ person }: { person: CatalogContact }) {
  // Do not turn arbitrary manifest URLs into executable navigation schemes.
  let website: string | undefined
  try {
    const url = new URL(person.url ?? '')
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      website = url.href
    }
  } catch {
    website = undefined
  }

  return <div className="catalog-contact"><span>{person.name}</span>
    {person.github && <a href={`https://github.com/${encodeURIComponent(person.github)}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <Icon name="github-line" />{person.github}</a>}
    {person.discord?.id ? <a href={`https://discord.com/users/${person.discord.id}`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
      <Icon name="discord-line" />{person.discord.username ?? person.discord.id}</a> : person.discord?.username ?
      <span className="catalog-contact-username"><Icon name="discord-line" />{person.discord.username}
        <CopyButton text={person.discord.username} label="Copy Discord username" size="sm" />
      </span> : null}
    {website && <a href={website} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Website</a>}
    {person.email && <a href={`mailto:${encodeURIComponent(person.email)}`}>Email</a>}
  </div>
}

/**
 * Shares catalog documentation/contact presentation across tools and both skill
 * formats. Documents and Markdown machinery load only when the owner opens them.
 */
export default function CatalogDetails({ entry, category, onClose }: CatalogDetailsProps) {
  const profile = useProfile()
  const [document, setDocument] = useState<'readme' | 'changelog' | 'contacts'>(entry.documents?.readme ? 'readme' : 'contacts')
  const endpoint = `${category}/${encodeURIComponent(entry.id)}`
  const content = useQuery({ queryKey: ['catalog-document', profile, category, entry.id, document],
    enabled: Boolean(profile && document !== 'contacts'),
    meta: { profile, errorTitle: 'I couldn’t load this document' },
    queryFn: ({ signal }) => requestAPI<CatalogDocument>(`${endpoint}/documents/${document}`, { signal }),
    staleTime: 60_000, gcTime: 60_000 })

  return <Dialog title={entry.name} description={entry.description} centered open size="large" hideFooter onClose={onClose}>
    <div className="catalog-details">
      <PackageIcon logoUrl={entry.logoUrl} iconName={entry.iconName} className="catalog-logo" />
      <div className="catalog-tabs" role="group" aria-label="Package information">
        {entry.documents?.readme && <Button size="sm" ariaPressed={document === 'readme'} onClick={() => setDocument('readme')}>Overview</Button>}
        {entry.documents?.changelog && <Button size="sm" ariaPressed={document === 'changelog'} onClick={() => setDocument('changelog')}>Changelog</Button>}
        <Button size="sm" ariaPressed={document === 'contacts'} onClick={() => setDocument('contacts')}>People</Button>
      </div>
      {document === 'contacts' ? <ScrollList className="catalog-document" aria-label="Package people">
        {entry.author && <section><h3>Created by</h3><Contact person={entry.author} /></section>}
        {entry.maintainers?.length ? <section><h3>Maintained by</h3>{entry.maintainers.map((person, index) => <Contact key={index} person={person} />)}</section> :
          <p>No maintenance contacts have been provided.</p>}
      </ScrollList> : content.isPending ? <Loader size="sm" label="Opening document…" /> : content.isError ?
        <Button onClick={() => void content.refetch()}>Retry</Button> : <ScrollList className="catalog-document" aria-label={document === 'readme' ? 'Overview' : 'Changelog'}>
          <Suspense fallback={<Loader size="sm" label="Opening document…" />}>
            <MarkdownContent animationId={`${profile}:${endpoint}:${document}`} text={content.data.text}
              imagePrefix={`/api/v1/${endpoint}/assets/`} />
          </Suspense>
        </ScrollList>}
    </div>
  </Dialog>
}
