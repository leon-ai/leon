import fs from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

import { LocalOcr, type OcrResult } from './local-ocr'
import { sliceLayout, type DocumentLayout, type LayoutReadOptions } from './document-layout'
import { PDFReader } from './pdf-reader'

const MAX_FILE_BYTES = 50 * 1_024 * 1_024
const MAX_IMAGE_DIMENSION = 2_048
const MAX_PAGE_COUNT = 8
const MAX_TEXT_CHARS = 40_000
const MAX_CACHE_CHARS = 2_000_000
const MAX_CACHE_ENTRIES = 32

export interface DocumentReadOptions {
  offsetChars?: number
  maxChars?: number
}

export interface PDFReadOptions extends DocumentReadOptions, LayoutReadOptions {
  startPage?: number
  pageCount?: number
  render?: boolean
  ocr?: boolean
}

export interface ImageReadOptions extends DocumentReadOptions, LayoutReadOptions {
  ocr?: boolean
  render?: boolean
}

interface ModelFile {
  dataBase64: string
  mediaType: string
  filename: string
}

/**
 * Local extraction and OCR belong to the file tool, not the model provider.
 * AnyDoc converts Office documents; LiteParse and RapidOCR handle PDF pages.
 */
export class DocumentReader {
  private readonly cache = new Map<string, { signature: string, text: string, layout?: DocumentLayout, size: number }>()
  private readonly pdf = new PDFReader()
  private readonly ocr = new LocalOcr()

  /**
   * Allow a local OCR backend to be evaluated without changing PDF extraction.
   */
  public constructor(private readonly localOcr?: (image: Buffer) => Promise<OcrResult>) {}

  /**
   * Convert Office/PDF documents once, then paginate cached Markdown.
   */
  public async readDocument(filePath: string, options: DocumentReadOptions = {}): Promise<Record<string, unknown>> {
    const signature = await this.signature(filePath)
    const cached = this.cache.get(filePath)
    let text = cached?.signature === signature ? cached.text : undefined
    if (text === undefined) {
      if (path.extname(filePath).toLowerCase() === '.pdf') {
        const parsed = await this.pdf.read(filePath)
        const emptyPages = parsed.pages.filter((page) => !page.text.trim()).map((page) => page.pageNum)
        // Do not return apparently complete text when image-only or capped pages
        // need a separate bounded read. No hosted OCR is used implicitly.
        if (emptyPages.length || parsed.pages.length < parsed.totalPages) {
          return { path: filePath, needsOcr: emptyPages.length > 0, requiresPageRead: true,
            pages: emptyPages, totalPages: parsed.totalPages, coverage: 'not extracted',
            nextAction: 'Use readPdf for bounded page reads; empty text layers use local OCR.' }
        }
        text = parsed.pages.map((page) => page.markdown).join('\n\n')
      } else {
        const { toMarkdown } = await import('@firecrawl/anydoc')
        text = await toMarkdown(filePath)
      }
      this.remember(filePath, signature, text)
    }
    return { path: filePath, format: 'markdown', ...this.chunk(text, options), cached: cached?.signature === signature,
      coverage: 'document text and structure; embedded images are not visually interpreted' }
  }

  /**
   * Read selected PDF pages. Empty text layers use local OCR by default.
   * Optional rendered evidence is independent of text-only model support.
   */
  public async readPdf(filePath: string, options: PDFReadOptions = {}): Promise<{
    data: Record<string, unknown>
    files: ModelFile[]
  }> {
    const signature = await this.signature(filePath)
    const startPage = options.startPage ?? 1
    const pageCount = options.pageCount ?? 1
    if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGE_COUNT) {
      throw new Error(`Use a positive startPage and pageCount between 1 and ${MAX_PAGE_COUNT}.`)
    }
    const document = await this.pdf.read(filePath, startPage, pageCount)
    const totalPages = document.totalPages
    if (startPage > totalPages) throw new Error(`The PDF has ${totalPages} pages.`)
    const lastPage = Math.min(startPage + pageCount - 1, totalPages)
    const pages = []
    const files: ModelFile[] = []
    let budget = options.maxChars ?? MAX_TEXT_CHARS
    let nextPage: number | null = lastPage < totalPages ? lastPage + 1 : null
    let nextOffsetChars = 0
    for (let number = startPage; number <= lastPage; number += 1) {
      const page = document.pages.find((item) => item.pageNum === number)
      if (!page) throw new Error(`Could not extract PDF page ${number}.`)
      const textLayerEmpty = !page.text.trim()
      const nativeText = textLayerEmpty ? '' : page.markdown.trim()
      const needsOcr = options.ocr === true || (textLayerEmpty && options.ocr !== false)
      const key = `${filePath}:page:${number}:${needsOcr ? 'ocr' : 'text'}`
      const cached = this.cache.get(key)
      let text = cached?.signature === signature ? cached.text : nativeText
      let layout = needsOcr ? (cached?.signature === signature ? cached.layout : undefined)
        : { width: page.width, height: page.height, units: 'points' as const, blocks: page.blocks ?? [] }
      let png: Buffer | undefined
      if (options.render || (needsOcr && cached?.signature !== signature)) {
        png = await this.pdf.render(filePath, page)
      }
      if (needsOcr && cached?.signature !== signature) ({ text, layout } = await this.recognize(png!))
      this.remember(key, signature, text, layout)
      const chunk = this.chunk(text, { offsetChars: number === startPage ? options.offsetChars ?? 0 : 0, maxChars: budget })
      pages.push({ page: number, ...chunk, format: needsOcr ? 'text' : 'markdown', textLayerEmpty,
        ...(options.layout ? { layout: layout ? sliceLayout(layout, options.layoutOffset) : null } : {}),
        method: needsOcr ? 'local_ocr' : 'text_layer', cached: cached?.signature === signature })
      budget -= chunk.text.length
      if (options.render && png) files.push({ dataBase64: png.toString('base64'), mediaType: 'image/png', filename: `${path.basename(filePath)}-page-${number}.png` })
      if (chunk.nextOffsetChars !== null) {
        nextPage = number
        nextOffsetChars = chunk.nextOffsetChars
        break
      }
      if (!budget && number < lastPage) { nextPage = number + 1; break }
    }
    return { data: { path: filePath, totalPages, pages, nextPage, nextOffsetChars,
      coverage: 'selected pages only; OCR is fallible and does not describe non-text visuals' }, files }
  }

  /**
   * OCR images locally by default; attach visual evidence only when requested.
   */
  public async readImage(filePath: string, options: ImageReadOptions = {}): Promise<{
    data: Record<string, unknown>
    files: ModelFile[]
  }> {
    const signature = await this.signature(filePath)
    const image = await loadImage(await fs.readFile(filePath))
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height))
    const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = canvas.toBuffer('image/png')
    const key = `${filePath}:image:ocr`
    const cached = this.cache.get(key)
    let text: string | undefined
    let layout: DocumentLayout | undefined
    if (options.ocr !== false) {
      ({ text, layout } = cached?.signature === signature ? cached : await this.recognize(png))
      this.remember(key, signature, text, layout)
    }
    return {
      data: { path: filePath, sourceWidth: image.width, sourceHeight: image.height, width: canvas.width, height: canvas.height,
        ...(options.layout ? { layout: layout ? sliceLayout(layout, options.layoutOffset) : null } : {}),
        ...(text !== undefined ? this.chunk(text, options) : {}), coverage: 'single frame; local OCR reads text, not visual meaning' },
      files: options.render ? [{ dataBase64: png.toString('base64'), mediaType: 'image/png', filename: `${path.basename(filePath)}.png` }] : []
    }
  }

  /**
   * Release local workers when the profile-owned tool worker is stopped.
   */
  public async dispose(): Promise<void> {
    await this.ocr.dispose()
    this.pdf.dispose()
    this.cache.clear()
  }

  private async recognize(image: Buffer): Promise<OcrResult> {
    if (this.localOcr) return this.localOcr(image)
    return this.ocr.recognize(image)
  }

  private chunk(text: string, options: DocumentReadOptions = {}): { text: string, offsetChars: number, totalChars: number, nextOffsetChars: number | null } {
    const offset = options.offsetChars ?? 0
    const size = options.maxChars ?? MAX_TEXT_CHARS
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length || !Number.isInteger(size) || size < 1 || size > MAX_TEXT_CHARS) {
      throw new Error(`Use a valid offsetChars and maxChars between 1 and ${MAX_TEXT_CHARS}.`)
    }
    return { text: text.slice(offset, offset + size), offsetChars: offset, totalChars: text.length,
      nextOffsetChars: offset + size < text.length ? offset + size : null }
  }

  private remember(key: string, signature: string, text: string, layout?: DocumentLayout): void {
    const size = text.length + (layout ? JSON.stringify(layout).length : 0)
    if (size > MAX_CACHE_CHARS) return
    this.cache.delete(key)
    this.cache.set(key, { signature, text, layout, size })
    while (this.cache.size > MAX_CACHE_ENTRIES || [...this.cache.values()].reduce((sum, item) => sum + item.size, 0) > MAX_CACHE_CHARS) {
      this.cache.delete(this.cache.keys().next().value!)
    }
  }

  private async signature(filePath: string): Promise<string> {
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Expected a local file no larger than 50 MiB.')
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  }
}
