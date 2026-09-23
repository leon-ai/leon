import type { LiteParse, ParseResult, ParsedPage } from '@llamaindex/liteparse'

const MAX_PAGE_COUNT = 1_000
const MAX_IMAGE_DIMENSION = 2_048
const MAX_DPI = 216

/**
 * Use native PDF layout extraction without LiteParse's bundled OCR fallback.
 * OCR stays owned by the file tool's resident multilingual worker.
 */
export class PDFReader {
  private parser: LiteParse | undefined

  /**
   * Return page-indexed Markdown; enforce a visible bound for whole documents.
   */
  public async read(filePath: string, startPage?: number, pageCount?: number): Promise<ParseResult> {
    const { LiteParse } = await import('@llamaindex/liteparse')
    const configuration = { ocrEnabled: false, outputFormat: 'markdown' as const,
      extractBlocks: true, quiet: true, numWorkers: 1, maxPages: MAX_PAGE_COUNT }
    if (startPage !== undefined) {
      const parser = new LiteParse({ ...configuration,
        targetPages: `${startPage}-${startPage + pageCount! - 1}` })
      try { return await parser.parse(filePath) } finally { parser.close() }
    }
    this.parser ??= new LiteParse(configuration)
    return this.parser.parse(filePath)
  }

  /**
   * Render just the requested page at a bounded size, not the whole document.
   */
  public async render(filePath: string, page: ParsedPage): Promise<Buffer> {
    const { LiteParse } = await import('@llamaindex/liteparse')
    const parser = new LiteParse({ ocrEnabled: false, quiet: true, numWorkers: 1,
      dpi: Math.min(MAX_DPI, MAX_IMAGE_DIMENSION * 72 / Math.max(page.width, page.height)) })
    try {
      const [image] = await parser.screenshot(filePath, [page.pageNum])
      if (!image) throw new Error(`Could not render PDF page ${page.pageNum}.`)
      return image.imageBuffer
    } finally { parser.close() }
  }

  /**
   * Release native resources when the profile-owned tool shuts down.
   */
  public dispose(): void {
    this.parser?.close()
    this.parser = undefined
  }
}
