import fs from 'node:fs'
import { finished } from 'node:stream/promises'

import PDFDocument from 'pdfkit'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

export interface DocumentContent {
  title: string
  sections: Array<{ heading?: string, paragraphs: string[] }>
  font_path?: string
}

/**
 * Creates predictable documents from structured content without executing model code.
 */
export async function writeDocument(
  filename: string,
  format: 'pdf' | 'docx',
  content: DocumentContent
): Promise<void> {
  if (format === 'docx') {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: content.title, heading: HeadingLevel.TITLE }),
            ...content.sections.flatMap((section) => [
              ...(section.heading
                ? [
                    new Paragraph({
                      text: section.heading,
                      heading: HeadingLevel.HEADING_1
                    })
                  ]
                : []),
              ...section.paragraphs.map(
                (text) =>
                  new Paragraph({
                    children: [new TextRun(text)],
                    spacing: { after: 160 }
                  })
              )
            ])
          ]
        }
      ]
    })

    await fs.promises.writeFile(filename, await Packer.toBuffer(document), {
      flag: 'wx'
    })

    return
  }

  const document = new PDFDocument({
    size: 'A4',
    margin: 54,
    info: { Title: content.title }
  })
  const output = fs.createWriteStream(filename, { flags: 'wx' })
  const completion = finished(output)

  document.on('error', (error) => output.destroy(error))
  document.pipe(output)
  if (content.font_path) {
    document.font(content.font_path)
  }

  document.fontSize(22).text(content.title).moveDown()
  for (const section of content.sections) {
    if (section.heading) {
      document.fontSize(15).text(section.heading).moveDown(0.5)
    }

    for (const paragraph of section.paragraphs) {
      document.fontSize(11).text(paragraph).moveDown()
    }
  }

  document.end()
  await completion
}
