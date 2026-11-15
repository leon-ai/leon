import { isPortableArtifactFilename } from './artifacts/artifact-types'

export const OWNER_ATTACHMENT_MAX_COUNT = 20
export const OWNER_ATTACHMENT_SOURCE = 'owner-attachment'
export const OWNER_ATTACHMENT_MAX_FILE_BYTES = 512 * 1_024 * 1_024
export const OWNER_ATTACHMENT_MAX_IMAGE_BYTES = 20 * 1_024 * 1_024
export const OWNER_ATTACHMENT_MAX_SPREADSHEET_BYTES = 50 * 1_024 * 1_024
export const OWNER_ATTACHMENT_TEXT_MEDIA_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
  'application/json', 'application/xml', 'application/yaml'
])
const MEDIA_TYPE_ALIASES: Record<string, readonly string[]> = {
  'application/rtf': ['text/rtf'],
  'audio/wav': ['audio/x-wav', 'audio/wave'],
  'audio/flac': ['audio/x-flac'],
  'audio/mp4': ['audio/x-m4a']
}

// Recognized containers retain their MIME and category limits. Other filenames
// are text candidates whose actual encoding is checked by the upload validator.
export const OWNER_ATTACHMENT_FORMATS = [
  { mediaType: 'image/png', extensions: ['.png'] },
  { mediaType: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { mediaType: 'image/webp', extensions: ['.webp'] },
  { mediaType: 'image/gif', extensions: ['.gif'] },
  { mediaType: 'application/pdf', extensions: ['.pdf'] },
  { mediaType: 'application/msword', extensions: ['.doc'] },
  { mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extensions: ['.docx'] },
  { mediaType: 'application/vnd.ms-excel', extensions: ['.xls'], spreadsheet: true },
  { mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extensions: ['.xlsx'], spreadsheet: true },
  { mediaType: 'application/vnd.ms-powerpoint', extensions: ['.ppt'] },
  { mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', extensions: ['.pptx'] },
  { mediaType: 'application/vnd.oasis.opendocument.text', extensions: ['.odt'] },
  { mediaType: 'application/vnd.oasis.opendocument.spreadsheet', extensions: ['.ods'], spreadsheet: true },
  { mediaType: 'application/vnd.oasis.opendocument.presentation', extensions: ['.odp'] },
  { mediaType: 'application/rtf', extensions: ['.rtf'] },
  { mediaType: 'application/epub+zip', extensions: ['.epub'] },
  { mediaType: 'text/plain', extensions: ['.txt', '.log'] },
  { mediaType: 'text/markdown', extensions: ['.md', '.markdown'] },
  { mediaType: 'text/csv', extensions: ['.csv'], spreadsheet: true },
  { mediaType: 'text/tab-separated-values', extensions: ['.tsv'], spreadsheet: true },
  { mediaType: 'application/json', extensions: ['.json'] },
  { mediaType: 'application/xml', extensions: ['.xml'] },
  { mediaType: 'application/yaml', extensions: ['.yaml', '.yml'] },
  { mediaType: 'audio/mpeg', extensions: ['.mp3'] },
  { mediaType: 'audio/wav', extensions: ['.wav'] },
  { mediaType: 'audio/flac', extensions: ['.flac'] },
  { mediaType: 'audio/ogg', extensions: ['.ogg', '.oga'] },
  { mediaType: 'audio/mp4', extensions: ['.m4a'] },
  { mediaType: 'video/mp4', extensions: ['.mp4'] },
  { mediaType: 'video/webm', extensions: ['.webm'] },
  { mediaType: 'video/quicktime', extensions: ['.mov'] }
] satisfies { mediaType: string, extensions: string[], spreadsheet?: boolean }[]

const TEXT_ATTACHMENT_FORMAT = OWNER_ATTACHMENT_FORMATS.find((format) => format.mediaType === 'text/plain')!

/**
 * Resolves known containers while accepting arbitrary text filenames, including
 * source code and extensionless configuration. Unknown types are stored as plain
 * text only after server-side encoding validation, never as their claimed MIME.
 */
export function getOwnerAttachmentFormat(filename: string, mediaType: string): typeof OWNER_ATTACHMENT_FORMATS[number] | undefined {
  if (!isPortableArtifactFilename(filename)) {
    return undefined
  }
  const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  const format = OWNER_ATTACHMENT_FORMATS.find((candidate) => candidate.extensions.includes(extension))
  if (!format || OWNER_ATTACHMENT_TEXT_MEDIA_TYPES.has(format.mediaType)) {
    return format ?? TEXT_ATTACHMENT_FORMAT
  }
  const normalizedType = mediaType.split(';', 1)[0]!.trim().toLowerCase()
  if (normalizedType && normalizedType !== 'application/octet-stream' &&
    normalizedType !== format.mediaType && !MEDIA_TYPE_ALIASES[format.mediaType]?.includes(normalizedType)) {
    return undefined
  }

  return format
}

/**
 * Applies ChatGPT's published byte limits by file category.
 */
export function getOwnerAttachmentSizeLimit(format: typeof OWNER_ATTACHMENT_FORMATS[number]): number {
  if (format.mediaType.startsWith('image/')) {
    return OWNER_ATTACHMENT_MAX_IMAGE_BYTES
  }
  if ('spreadsheet' in format && format.spreadsheet) {
    return OWNER_ATTACHMENT_MAX_SPREADSHEET_BYTES
  }

  return OWNER_ATTACHMENT_MAX_FILE_BYTES
}
