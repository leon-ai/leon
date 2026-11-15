import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { OWNER_ATTACHMENT_TEXT_MEDIA_TYPES } from './owner-attachment-contract'

const HEADER_BYTES = 4_096
const ZIP_SIGNATURE = '504b0304'
const OFFICE_SIGNATURE = 'd0cf11e0a1b11e1'
const SIGNATURES: Record<string, string[]> = {
  'image/png': ['89504e470d0a1a0a'],
  'image/jpeg': ['ffd8ff'],
  'image/gif': ['474946383761', '474946383961'],
  'application/pdf': ['255044462d'],
  'application/msword': [OFFICE_SIGNATURE],
  'application/vnd.ms-excel': [OFFICE_SIGNATURE],
  'application/vnd.ms-powerpoint': [OFFICE_SIGNATURE],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [ZIP_SIGNATURE],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [ZIP_SIGNATURE],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [ZIP_SIGNATURE],
  'application/vnd.oasis.opendocument.text': [ZIP_SIGNATURE],
  'application/vnd.oasis.opendocument.spreadsheet': [ZIP_SIGNATURE],
  'application/vnd.oasis.opendocument.presentation': [ZIP_SIGNATURE],
  'application/epub+zip': [ZIP_SIGNATURE],
  'application/rtf': ['7b5c727466'],
  'audio/flac': ['664c6143'],
  'audio/ogg': ['4f676753'],
  'video/webm': ['1a45dfa3']
}
const MP4_MEDIA_TYPES = new Set(['audio/mp4', 'video/mp4', 'video/quicktime'])
const ZIP_END_SIGNATURE = Buffer.from('504b0506', 'hex')
const ZIP_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_BYTES = 22
const ZIP_DIRECTORY_ENTRY_BYTES = 46
const MAXIMUM_ZIP_COMMENT_BYTES = 65_535
const MAXIMUM_ZIP_DIRECTORY_BYTES = 4 * 1_024 * 1_024
const PACKAGE_ENTRIES: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
  'application/vnd.oasis.opendocument.text': 'content.xml',
  'application/vnd.oasis.opendocument.spreadsheet': 'content.xml',
  'application/vnd.oasis.opendocument.presentation': 'content.xml',
  'application/epub+zip': 'META-INF/container.xml'
}

/**
 * Distinguishes document packages from renamed arbitrary ZIP archives. Read only
 * the bounded directory and the required uncompressed MIME entry; never extract.
 */
async function validateDocumentPackage(filename: string, mediaType: string, header: Buffer): Promise<boolean> {
  const required = PACKAGE_ENTRIES[mediaType]!
  const file = await fs.open(filename, 'r')
  try {
    const stat = await file.stat()
    const tail = Buffer.alloc(Math.min(stat.size, ZIP_END_BYTES + MAXIMUM_ZIP_COMMENT_BYTES))
    await file.read(tail, 0, tail.length, stat.size - tail.length)
    const end = tail.lastIndexOf(ZIP_END_SIGNATURE)
    if (end < 0 || end + ZIP_END_BYTES > tail.length ||
      end + ZIP_END_BYTES + tail.readUInt16LE(end + 20) !== tail.length) {
      return false
    }
    const size = tail.readUInt32LE(end + 12)
    const offset = tail.readUInt32LE(end + 16)
    if (!size || size > MAXIMUM_ZIP_DIRECTORY_BYTES || offset + size > stat.size - ZIP_END_BYTES) {
      return false
    }
    const directory = Buffer.alloc(size)
    await file.read(directory, 0, size, offset)
    const names = new Set<string>()
    let index = 0
    while (index + ZIP_DIRECTORY_ENTRY_BYTES <= size) {
      if (directory.readUInt32LE(index) !== ZIP_DIRECTORY_SIGNATURE) {
        return false
      }
      const nameLength = directory.readUInt16LE(index + 28)
      const entryEnd = index + ZIP_DIRECTORY_ENTRY_BYTES + nameLength +
        directory.readUInt16LE(index + 30) + directory.readUInt16LE(index + 32)
      if (entryEnd > size) {
        return false
      }
      names.add(directory.toString('utf8', index + ZIP_DIRECTORY_ENTRY_BYTES, index + ZIP_DIRECTORY_ENTRY_BYTES + nameLength))
      index = entryEnd
    }
    if (index !== size || !names.has(required)) {
      return false
    }
    if (mediaType.startsWith('application/vnd.openxmlformats-')) {
      return names.has('[Content_Types].xml')
    }
    // ODF and EPUB require the MIME entry first and stored without compression.
    const nameLength = header.readUInt16LE(26)
    const contentStart = 30 + nameLength + header.readUInt16LE(28)

    return header.readUInt16LE(8) === 0 && header.toString('utf8', 30, 30 + nameLength) === 'mimetype' &&
      header.toString('utf8', contentStart, contentStart + header.readUInt32LE(18)) === mediaType
  } finally {
    await file.close()
  }
}

/**
 * Checks container signatures and validates text incrementally, without loading
 * a potentially large upload into memory or trusting its declared MIME type.
 */
export async function validateOwnerAttachmentContent(filename: string, mediaType: string): Promise<void> {
  const file = await fs.open(filename, 'r')
  const header = Buffer.alloc(HEADER_BYTES)
  let bytesRead: number
  try {
    ;({ bytesRead } = await file.read(header, 0, header.length, 0))
  } finally {
    await file.close()
  }
  const bytes = header.subarray(0, bytesRead)
  const hex = bytes.toString('hex')
  let valid = SIGNATURES[mediaType]?.some((signature) => hex.startsWith(signature)) ?? false

  if (valid && PACKAGE_ENTRIES[mediaType]) {
    valid = bytes.length >= 30 && await validateDocumentPackage(filename, mediaType, bytes)
  }

  if (mediaType === 'image/webp' || mediaType === 'audio/wav') {
    valid = bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === (mediaType === 'image/webp' ? 'WEBP' : 'WAVE')
  } else if (MP4_MEDIA_TYPES.has(mediaType)) {
    valid = bytes.toString('ascii', 4, 8) === 'ftyp' ||
      mediaType === 'video/quicktime' && bytes.toString('ascii', 4, 8) === 'moov'
  } else if (mediaType === 'audio/mpeg') {
    valid = bytes.toString('ascii', 0, 3) === 'ID3' ||
      bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0
  } else if (OWNER_ATTACHMENT_TEXT_MEDIA_TYPES.has(mediaType)) {
    const encoding = hex.startsWith('fffe') ? 'utf-16le' : hex.startsWith('feff') ? 'utf-16be' : 'utf-8'
    const decoder = new TextDecoder(encoding, { fatal: true })
    try {
      for await (const chunk of createReadStream(filename)) {
        const text = decoder.decode(chunk as Buffer, { stream: true })
        if (text.includes('\0')) {
          throw new Error('Binary content is not a text attachment.')
        }
      }
      decoder.decode()
      valid = true
    } catch {
      valid = false
    }
  }

  if (!valid) {
    throw new Error('The file contents do not match the declared attachment type.')
  }
}
