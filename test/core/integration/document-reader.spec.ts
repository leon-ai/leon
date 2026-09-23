import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import { DocumentReader } from '@@/tools/operating_system_control/file/src/nodejs/lib/document-reader'
import { LocalOcr } from '@@/tools/operating_system_control/file/src/nodejs/lib/local-ocr'
import { sliceLayout } from '@@/tools/operating_system_control/file/src/nodejs/lib/document-layout'
import { prepareOwnerAttachments } from '@/core/owner-attachments'

const profile = vi.hoisted(() => ({ sessions: '' }))
vi.mock('@/constants', () => ({ OWNER_ATTACHMENT_MAX_BYTES: 8 * 1_024 * 1_024 }))
vi.mock('@/core/profile-runtime/profile-paths', () => ({ getProfilePaths: (): typeof profile => profile }))

let directory: string | undefined
let reader: DocumentReader

afterEach(async () => {
  await reader?.dispose()
  if (directory) await fs.rm(directory, { recursive: true, force: true })
})

// A self-contained PDF fixture keeps this check offline and free of owner data.
function pdf(text: string, fontSize = 18): string {
  const stream = `BT /F1 ${fontSize} Tf 30 100 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ]
  let result = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(result.length)
    result += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = result.length
  result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  return `${result}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

it('extracts, caches, invalidates and renders PDF evidence without a model call', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-document-'))
  const file = path.join(directory, 'sample.pdf')
  await fs.writeFile(file, pdf('Document total: 123.45'))
  reader = new DocumentReader()
  const first = await reader.readPdf(file, { render: true, layout: true })
  expect(first.data).toMatchObject({ totalPages: 1, nextPage: null,
    pages: [{ page: 1, text: expect.stringContaining('Document total: 123.45'), cached: false }] })
  expect(first.files[0]?.mediaType).toBe('image/png')
  expect(first.data['pages']).toMatchObject([{ layout: { width: 300, height: 160, units: 'points',
    blocks: expect.arrayContaining([expect.objectContaining({ bbox: expect.any(Object) })]), nextLayoutOffset: null } }])
  expect(Buffer.from(first.files[0]!.dataBase64, 'base64').subarray(1, 4).toString()).toBe('PNG')
  expect((await reader.readPdf(file)).data['pages']).toMatchObject([{ cached: true }])
  await fs.writeFile(file, pdf('Corrected total: 678.90'))
  expect((await reader.readPdf(file)).data['pages']).toMatchObject([{ text: expect.stringContaining('Corrected total: 678.90'), cached: false }])
  await expect(reader.readPdf(file, { startPage: 2 })).rejects.toThrow('1 pages')
  const imagePath = path.join(directory, 'page.png')
  await fs.writeFile(imagePath, Buffer.from(first.files[0]!.dataBase64, 'base64'))
  const started = performance.now()
  expect((await reader.readImage(imagePath)).data).toMatchObject({ width: 900, height: 480, text: expect.stringContaining('123.45') })
  const cold = performance.now() - started
  const warmStarted = performance.now()
  expect((await reader.readImage(imagePath, { layout: true })).data).toMatchObject({ text: expect.stringContaining('123.45'),
    layout: { width: 900, height: 480, units: 'pixels', blocks: expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('123.45'), confidence: expect.any(Number), polygon: expect.any(Array) })]) } })
  const visualOnly = await reader.readImage(imagePath, { ocr: false, render: true })
  expect(visualOnly.data).not.toHaveProperty('text')
  expect(visualOnly.files).toHaveLength(1)
  const layout = { width: 300, height: 160, units: 'points' as const, blocks: [
    { kind: 'paragraph' as const, text: 'x'.repeat(25_000) },
    { kind: 'table' as const, header: [{ text: 'Column', bbox: { x: 10, y: 10, width: 50, height: 20 } }], rows: [[{ text: 'y'.repeat(25_000) }]] }
  ] }
  expect(sliceLayout(layout)).toMatchObject({ totalBlocks: 2, nextLayoutOffset: 1 })
  expect(sliceLayout(layout, 1)).toMatchObject({ blocks: [layout.blocks[1]], nextLayoutOffset: null })
  expect(sliceLayout({ ...layout, blocks: [{ kind: 'paragraph', text: 'x'.repeat(50_000) }] }))
    .toMatchObject({ blocks: [{ omitted: expect.any(String) }], nextLayoutOffset: null })
  expect(() => sliceLayout(layout, -1)).toThrow('layoutOffset')
  console.info(`Local OCR: cold=${Math.round(cold)}ms cached=${Math.round(performance.now() - warmStarted)}ms`)
  profile.sessions = directory
  const prepared = await prepareOwnerAttachments('Read both.', [
    { filename: '../../source.pdf', mediaType: 'application/pdf', dataBase64: (await fs.readFile(file)).toString('base64') },
    first.files[0]!
  ], 'session')
  expect(prepared.files).toEqual(first.files)
  expect(prepared.query).not.toContain(first.files[0]!.dataBase64)
  expect(await fs.readdir(path.join(directory, 'session', 'attachments'))).toHaveLength(2)
  await expect(prepareOwnerAttachments('Read.', [{ dataBase64: '!', mediaType: 'image/png' }], 'session')).rejects.toThrow('Invalid attachment')
  await fs.writeFile(file, pdf(''))
  expect(await reader.readDocument(file)).toMatchObject({ needsOcr: true, requiresPageRead: true, pages: [1] })
  expect((await reader.readPdf(file, { ocr: false })).data['pages']).toMatchObject([{ textLayerEmpty: true }])
  expect((await reader.readPdf(file, { layout: true })).data['pages']).toMatchObject([
    { text: '', method: 'local_ocr', layout: { width: 900, height: 480, blocks: [], nextLayoutOffset: null } }
  ])
  const csv = path.join(directory, 'sample.csv')
  await fs.writeFile(csv, 'Item,Amount\nTravel,123.45\n')
  const document = await reader.readDocument(csv, { maxChars: 10 })
  expect(document).toMatchObject({ format: 'markdown', nextOffsetChars: 10 })
  expect(await reader.readDocument(csv, { offsetChars: 10 })).toMatchObject({ cached: true, text: expect.stringContaining('123.45') })
})

it('serializes local OCR responses, recovers after bad input and releases its worker', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-ocr-worker-'))
  const file = path.join(directory, 'sample.pdf')
  await fs.writeFile(file, pdf('Serialized total: 123.45'))
  reader = new DocumentReader()
  const { files } = await reader.readPdf(file, { render: true })
  const image = Buffer.from(files[0]!.dataBase64, 'base64')
  const ocr = new LocalOcr()
  try {
    await expect(ocr.recognize(Buffer.from('not an image'))).rejects.toThrow()
    // Two concurrent callers must receive separate responses, not share listeners.
    const results = await Promise.all([ocr.recognize(image), ocr.recognize(image)])
    expect(results).toMatchObject([
      { text: expect.stringContaining('123.45') }, { text: expect.stringContaining('123.45') }
    ])
  } finally { await ocr.dispose() }
  await expect(ocr.recognize(Buffer.alloc(0))).rejects.toThrow('disposed')
})
