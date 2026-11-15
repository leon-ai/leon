import { ArtifactWidget, type ArtifactItem } from '../../../../aurora/src/v2/widgets/artifacts'
import { FileIcon } from '@/components/icon'
import { VisualPreview } from '@/components/visual-preview/visual-preview'

import './files-preview.sass'

import image from '../../../../aurora/preview/public/pancakes.jpeg?url&no-inline'
import pdf from '../../../fixtures/documents/attention-is-all-you-need.pdf?url&no-inline'
import video from '../../../fixtures/artifacts/a-quiet-moment.webm?url&no-inline'
import audio from '../../../fixtures/artifacts/a-soft-note.wav?url&no-inline'
import document from '../../../fixtures/artifacts/field-notes.docx?url&no-inline'
import text from '../../../fixtures/artifacts/notes.txt?url&no-inline'
import csv from '../../../fixtures/artifacts/moments.csv?url&no-inline'
import json from '../../../fixtures/artifacts/moments.json?url&no-inline'
import code from '../../../fixtures/artifacts/greeting.py?url&no-inline'
import archive from '../../../fixtures/artifacts/project-notes.zip?url&no-inline'
import unknown from '../../../fixtures/artifacts/sample.leon?url&no-inline'

const GROUPS: { title: string, description: string, items: ArtifactItem[] }[] = [
  { title: 'Images', description: 'Lazy image loading, enlargement and downloads.', items: [
    { id: 'photo', filename: 'Sunday pancakes.jpeg', mimeType: 'image/jpeg', url: image }
  ] },
  { title: 'Video', description: 'A small local clip. Playback starts only when you press play.', items: [
    { id: 'video', filename: 'A quiet moment.webm', mimeType: 'video/webm', url: video, sizeLabel: '3 KB' }
  ] },
  { title: 'Audio', description: 'A short, quiet tone with native playback controls.', items: [
    { id: 'audio', filename: 'A soft note.wav', mimeType: 'audio/wav', url: audio, sizeLabel: '32 KB' }
  ] },
  { title: 'Documents', description: 'PDF and Office files keep the existing open/download presentation.', items: [
    { id: 'pdf', filename: 'Attention is all you need.pdf', mimeType: 'application/pdf', url: pdf },
    { id: 'document', filename: 'Field notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', url: document, sizeLabel: '1 KB' }
  ] },
  { title: 'Text, code and data', description: 'The same file card uses filename-aware artwork for each format.', items: [
    { id: 'text', filename: 'Notes.txt', mimeType: 'text/plain', url: text, sizeLabel: '1 KB' },
    { id: 'csv', filename: 'Moments.csv', mimeType: 'text/csv', url: csv },
    { id: 'json', filename: 'Moments.json', mimeType: 'application/json', url: json },
    { id: 'code', filename: 'Greeting.py', mimeType: 'text/plain', url: code }
  ] },
  { title: 'Archives and other files', description: 'Archives and unknown formats stay downloadable rather than being embedded.', items: [
    { id: 'archive', filename: 'Project notes.zip', mimeType: 'application/zip', url: archive },
    { id: 'unknown', filename: 'Sample.leon', mimeType: 'application/octet-stream', url: unknown }
  ] }
]
const FILE_NAMES = ['README.md', 'package.json', 'Dockerfile', '.gitignore', 'main.rs', 'Program.cs', 'main.kt', 'Main.java']

/**
 * Keeps generated artifacts distinct from owner-provided attachments while
 * exercising the real file components with local fixtures.
 */
export default function FilesPreview() {
  return <section className="files-preview" aria-label="Files preview">
    <section className="demo-stack" aria-label="Artifacts preview">
      <header className="files-preview-heading">
        <h2>Artifacts</h2>
        <p>Files Leon creates or shares with you.</p>
      </header>
      {GROUPS.map((group) => <ArtifactWidget key={group.title} {...group}
        renderFileIcon={(filename) => <FileIcon fileName={filename} />}
        renderImagePreview={(item, content) => <VisualPreview title={item.filename} fullWidth>{content}</VisualPreview>} />)}
      <section className="demo-stack" aria-label="File icons">
        <h3>File icons</h3>
        <p>File types and special filenames share the same local artwork as code headers.</p>
        <div className="demo-controls">
          {FILE_NAMES.map((filename) => <span key={filename}>
            <FileIcon fileName={filename} ariaLabel={filename} /> {filename}
          </span>)}
        </div>
      </section>
    </section>
    <section className="demo-stack" aria-label="Attachments preview">
      <header className="files-preview-heading">
        <h2>Attachments</h2>
        <p>Files you share with Leon.</p>
      </header>
      <p>Attachment and drop-zone previews will be added here.</p>
    </section>
  </section>
}
