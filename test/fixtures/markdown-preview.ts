export interface MarkdownPreviewExample {
  id: string
  title: string
  description: string
  source: string
}

/**
 * Covers the supported Markdown pipeline and explicit literal fallbacks without
 * importing an owner's conversation or fetching remote example content.
 */
export function createMarkdownPreviewExamples(imageURL: string): MarkdownPreviewExample[] {
  return [
    {
      id: 'typography', title: 'Headings and text',
      description: 'Six heading levels, inline formatting, escaping, line breaks, horizontal rules and multilingual text.',
      source: [
        '# A little room for ideas', '## Make something with care', '### Find a gentle pace',
        '#### Keep the useful pieces', '##### Leave room to explore', '###### Start wherever you are', '',
        'Regular text, **bold**, *italic*, ***bold and italic***, ~~strikethrough~~ and **bold with _italic_ inside**.', '',
        'Inline code: `const answer = 42`. Backticks inside code: ``Use `code` here``.', '',
        'Escaped punctuation: \\*not italic\\*, \\# not a heading, and < > &.', '',
        'A separate paragraph with enough words to check wrapping and comfortable reading.', '',
        'A deliberate line break.  ', 'Still the same paragraph.', '', '---', '', '***', '', '___', '',
        'Café, naïve, résumé. 你好，世界。こんにちは。مرحبا بالعالم。 🎨 🌱'
      ].join('\n')
    },
    {
      id: 'lists', title: 'Lists and tasks', description: 'Nested unordered, ordered and mixed lists, custom starting numbers and task checkmarks.',
      source: [
        '- A small idea', '  - A little detail', '    - A third level', '- Another idea', '',
        '* An asterisk bullet', '* Another bullet', '', '+ A plus bullet', '+ Another bullet', '',
        '1. Read the notes', '2. Try one thing', '   1. Keep it small', '   2. Check the result', '3. Take a break', '',
        'A separate list with a different starting number:', '', '7. A different starting number', '8. The next step', '',
        '- [x] Keep the useful pieces', '- [ ] Leave room for a new idea', '  - [x] Sketch a first version', '  - [ ] Try it tomorrow'
      ].join('\n')
    },
    {
      id: 'quotes', title: 'Blockquotes', description: 'Nested quotations containing paragraphs, lists and formatted text.',
      source: [
        '> A quiet thought.', '>', '> A second paragraph, with **something worth keeping**.', '>',
        '> > A thought inside a thought.', '>', '> - Read slowly', '> - Make a little room', '',
        '> ### A useful reminder', '> There is no need to rush.'
      ].join('\n')
    },
    {
      id: 'links', title: 'Links and file references',
      description: 'Web, reference, automatic and email links with URL tooltips. Favicons are local fixtures; host-file opening is disabled here.',
      source: [
        '[Leon website](https://getleon.ai "Leon AI")', '', '[Reference-style link][leon]', '',
        'Automatic URL: https://getleon.ai', '', 'Autolink: <https://getleon.ai>', '',
        '[Email example](mailto:hello@example.com)', '',
        '[Jump to the local note](#local-note)', '', '<div id="local-note">A local note, scoped to this example.</div>', '',
        'A copyable host file: [FILE_PATH]test/fixtures/artifacts/notes.txt[/FILE_PATH]', '',
        '[leon]: https://getleon.ai "A reference title"'
      ].join('\n')
    },
    {
      id: 'tables', title: 'Tables', description: 'Column alignment, formatted cells, escaped pipes and wide-table wrapping. Image export uses the real table actions.',
      source: [
        '| Left aligned | Center aligned | Right aligned |', '| :--- | :---: | ---: |',
        '| Reading | Ready | 20 |', '| Drawing | Pending | 15 |', '',
        '| Feature | Example |', '| --- | --- |', '| Bold | **Important** |', '| Italic | *Emphasis* |',
        '| Code | `pnpm lint` |', '| Escaped pipe | A \\| B |', '',
        '| Monday | Tuesday | Wednesday | Thursday | Friday | Saturday | Sunday |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| Read quietly | Draw something | Try an idea | Walk outside | Keep a note | Make breakfast | Leave room |'
      ].join('\n')
    },
    {
      id: 'code', title: 'Code blocks', description: 'Language artwork, syntax coloring, plain text, indented code, nested fences, diffs and unsupported-language fallbacks.',
      source: [
        '```typescript', 'type Moment = { title: string; minutes: number }', 'const moment: Moment = { title: "Reading", minutes: 20 }', '```', '',
        '```python', 'def greet(name: str) -> str:', '    return f"Welcome home, {name}."', '```', '',
        '```json', '{ "quiet": true, "minutes": 20 }', '```', '',
        '```bash', 'pnpm lint', '```', '',
        '```diff', '- const greeting = "Hello"', '+ const greeting = "Welcome home"', '```', '',
        '```text', '  Keep indentation.', 'Special characters: < > & * _ # |', '```', '',
        '    An indented block.', '    Another line.', '',
        '````markdown', '```javascript', 'console.log("A nested fence")', '```', '````', '',
        '```unknown-language', 'Readable text when no language artwork or lexer exists.', '```'
      ].join('\n')
    },
    {
      id: 'long-code', title: 'Long and wide code', description: 'A bounded code viewport with vertical and horizontal scrolling, without widening the surrounding message.',
      source: ['```typescript', 'const longLine = "A little room for ideas. ' + 'Keep the useful pieces together. '.repeat(12) + '"',
        ...Array.from({ length: 80 }, (_, index) => `const note${index + 1} = { title: "Idea ${index + 1}", minutes: ${(index + 1) * 5} }`),
        'console.log(longLine)', '```'].join('\n')
    },
    {
      id: 'details', title: 'Collapsible details and safe HTML', description: 'Native details sections, initially open details, keyboard hints, superscript and subscript.',
      source: [
        '<details>', '<summary>A little more</summary>', '', '### The useful details', '',
        'Some **formatted content** and a list:', '', '- A first note', '- Another note', '', '</details>', '',
        '<details open>', '<summary>Already open</summary>', '', 'This section starts expanded.', '', '</details>', '',
        'A keyboard hint: <kbd>Enter</kbd>. Superscript: x<sup>2</sup>. Subscript: H<sub>2</sub>O.'
      ].join('\n')
    },
    {
      id: 'alerts', title: 'GitHub alerts', description: 'All five supported alert styles with their actual shared icons and colors.',
      source: [
        '> [!NOTE]', '> A little background that may help.', '',
        '> [!TIP]', '> Try a small first step.', '',
        '> [!IMPORTANT]', '> Keep the original notes before making changes.', '',
        '> [!WARNING]', '> This action could overwrite a file.', '',
        '> [!CAUTION]', '> Check the destination before continuing.'
      ].join('\n')
    },
    {
      id: 'footnotes', title: 'Footnotes', description: 'Repeated references, multiple notes, formatted content and return links with scoped IDs.',
      source: [
        'A little room can make an idea easier to see.[^room]', '',
        'The same thought, with the same reference.[^room] Another note is separate.[^craft]', '',
        '[^room]: A footnote with **bold text** and `inline code`.', '',
        '[^craft]: Keep the useful pieces together.'
      ].join('\n')
    },
    {
      id: 'math', title: 'Math formulas', description: 'Inline and display math, fractions, integrals, aligned expressions and matrices.',
      source: String.raw`Inline math: $E = mc^2$ and $a^2 + b^2 = c^2$.

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

$$
\begin{aligned}
f(x) &= x^2 + 2x + 1 \\
     &= (x + 1)^2
\end{aligned}
$$

$$
A = \begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}
$$`
    },
    {
      id: 'diagrams', title: 'Mermaid diagrams', description: 'Flowcharts, sequences and pie charts. Use the real source switch, enlargement and image actions.',
      source: [
        '```mermaid', 'flowchart LR', '  A[A small idea] --> B{Try it?}', '  B -->|Yes| C[Make a sketch]', '  B -->|Later| D[Keep a note]', '```', '',
        '```mermaid', 'sequenceDiagram', '  Owner->>Leon: Help me explore an idea', '  Leon-->>Owner: Here is a small first step', '```', '',
        '```mermaid', 'pie title A quiet afternoon', '  "Reading" : 20', '  "Drawing" : 15', '  "Walking" : 30', '```'
      ].join('\n')
    },
    {
      id: 'images', title: 'Images and privacy fallbacks', description: 'A host-approved local image renders. External image URLs remain alt text and are never requested.',
      source: `![Sunday pancakes](${imageURL})\n\n![External image blocked for privacy](https://example.invalid/private-image.png)`
    },
    {
      id: 'combined', title: 'Combined formatting', description: 'A realistic mixture of headings, quotes, tasks, tables, details and code.',
      source: [
        '## A small project', '', '> **A gentle plan:** keep the first version simple.', '',
        '1. Read the existing notes.', '2. Try a small change:', '   - [x] Sketch the idea', '   - [ ] Check the result', '',
        '| Part | State |', '| --- | --- |', '| Notes | **Ready** |', '| Sketch | *In progress* |', '',
        '<details>', '<summary>Implementation note</summary>', '', '```json', '{ "pace": "gentle", "ready": true }', '```', '', '</details>'
      ].join('\n')
    },
    {
      id: 'fallbacks', title: 'Unsupported extensions', description: 'These shorthands do not enable extra extensions. Standard Markdown formatting may still apply inside them.',
      source: [
        'Definition lists:', '', 'Markdown', ': A lightweight markup language.', '',
        'Highlight shorthand: ==highlighted text==', '', 'Subscript shorthand: H~2~O', '',
        'Superscript shorthand: x^2^', '', 'Emoji shortcode: :rocket:', '',
        'Collapsible-callout suffixes are not disclosures; use the details example instead.', '',
        '> [!NOTE]- A note, not a collapsible section', '> This remains an ordinary alert.'
      ].join('\n')
    }
  ]
}
