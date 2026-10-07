import fs from 'node:fs'

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

export interface DocumentContent {
  title: string
  sections: Array<{ heading?: string, paragraphs: string[] }>
}

/**
 * Creates an editable Word document from structured content.
 */
export async function writeDocument(
  filename: string,
  content: DocumentContent
): Promise<void> {
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

}
