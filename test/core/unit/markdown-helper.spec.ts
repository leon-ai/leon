import { describe, expect, it } from 'vitest'

import { markdownToText } from '@/helpers/markdown-helper'

describe('Markdown speech text', () => {
  it('reads prose and link labels without visual markup or hidden destinations', () => {
    const text = markdownToText('## A guide\nA **warm** *welcome* with [one source](https://example.com).\n\n- First idea\n- Next idea\n\n`hello()`')
    expect(text).toContain('A guide\nA warm welcome with one source.')
    expect(text).toContain('First idea\nNext idea')
    expect(text).toContain('hello()')
    expect(text).not.toMatch(/https:|\*|`|##/)
  })

  it('keeps table cells and code readable without their Markdown delimiters', () => {
    const text = markdownToText('| Name | Value |\n| --- | --- |\n| Pace | Gentle |\n\n```js\nconst idea = 1\n```')
    expect(text).toContain('Name, Value\nPace, Gentle')
    expect(text).toContain('const idea = 1')
    expect(text).not.toContain('```')
    expect(text).not.toContain('|')
  })
})
