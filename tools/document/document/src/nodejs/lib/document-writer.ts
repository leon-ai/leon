import fs from 'node:fs'
import path from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun
} from 'docx'

const DEFAULT_IMAGE_WIDTH = 480
const MAX_IMAGE_WIDTH = 624

/**
 * A selected chart/image asset to embed with preserved proportions.
 */
export interface DocumentImage {
  path: string
  caption?: string
  altText?: string
  width?: number
}

/**
 * Structured content for editable Word documents.
 */
export interface DocumentContent {
  title: string
  sections: Array<{
    heading?: string
    paragraphs: string[]
    images?: DocumentImage[]
  }>
}

/**
 * Creates an editable Word document from structured content.
 */
export async function writeDocument(
  filename: string,
  content: DocumentContent
): Promise<void> {
  const children = [
    new Paragraph({ text: content.title, heading: HeadingLevel.TITLE })
  ]

  for (const section of content.sections) {
    if (section.heading) {
      children.push(new Paragraph({
        text: section.heading,
        heading: HeadingLevel.HEADING_1
      }))
    }

    children.push(...section.paragraphs.map((text) => new Paragraph({
      children: [new TextRun(text)],
      spacing: { after: 160 }
    })))

    for (const image of section.images ?? []) {
      children.push(...await createImageParagraphs(image))
    }
  }

  const document = new Document({
    sections: [{ children }]
  })

  await fs.promises.writeFile(filename, await Packer.toBuffer(document), {
    flag: 'wx'
  })
}

/**
 * Embeds local chart assets, including a raster fallback for SVG-capable Word files.
 */
async function createImageParagraphs(image: DocumentImage): Promise<Paragraph[]> {
  if (!path.isAbsolute(image.path)) {
    throw new Error('Document image paths must be absolute local paths.')
  }

  const extension = path.extname(image.path).toLowerCase()

  if (extension !== '.svg' && extension !== '.png') {
    throw new Error('Use local SVG or PNG assets for document images.')
  }

  const bytes = await fs.promises.readFile(image.path)
  const decoded = await loadImage(bytes)
  const width = image.width ?? Math.min(DEFAULT_IMAGE_WIDTH, decoded.width)

  if (!Number.isInteger(width) || width < 1 || width > MAX_IMAGE_WIDTH) {
    throw new Error(`Document image width must be an integer from 1 to ${MAX_IMAGE_WIDTH} pixels.`)
  }

  const transformation = {
    width,
    height: Math.max(1, Math.round(width * decoded.height / decoded.width))
  }
  const altText = {
    name: path.basename(image.path),
    title: image.caption ?? path.basename(image.path),
    description: image.altText ?? image.caption ?? ''
  }
  let run: ImageRun

  if (extension === '.svg') {
    // Word readers vary in SVG support. Keep the vector image and provide a
    // PNG fallback so the chart remains visible in older Office renderers.
    const canvas = createCanvas(decoded.width, decoded.height)

    canvas.getContext('2d').drawImage(decoded, 0, 0)
    run = new ImageRun({
      type: 'svg',
      data: bytes,
      fallback: { type: 'png', data: await canvas.encode('png') },
      transformation,
      altText
    })
  } else {
    run = new ImageRun({ type: 'png', data: bytes, transformation, altText })
  }

  const paragraphs = [new Paragraph({
    children: [run],
    alignment: AlignmentType.CENTER,
    keepNext: Boolean(image.caption),
    spacing: { before: 160, after: 160 }
  })]

  if (image.caption) {
    paragraphs.push(new Paragraph({
      text: image.caption,
      style: 'Caption',
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 }
    }))
  }

  return paragraphs
}
