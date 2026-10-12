import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { contentHash, patchTextFile } from '@@/tools/file_system/file/src/nodejs/lib/text-patch'

let directory = ''

afterEach(async () => {
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture(content: string): Promise<string> {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-patch-'))
  const target = path.join(directory, 'source.ts')
  await fs.writeFile(target, content, { mode: 0o755 })
  return target
}

it('applies simultaneous replacements while preserving BOM, CRLF and executable mode', async () => {
  const original = '\uFEFFconst first = 1\r\nconst second = 2\r\n'
  const target = await fixture(original)
  const hash = contentHash(await fs.readFile(target))
  const result = await patchTextFile(target, [
    { oldText: 'const first = 1', newText: 'const first = 2\nconst extra = 3' },
    { oldText: 'const second = 2', newText: 'const second = 1' }
  ], { expectedContentHash: hash })

  expect(await fs.readFile(target, 'utf8'))
    .toBe('\uFEFFconst first = 2\r\nconst extra = 3\r\nconst second = 1\r\n')
  expect(result).toMatchObject({ changed: true, replacements: 2, diffTruncated: false })
  expect(result['contentHash']).toBe(contentHash(await fs.readFile(target)))
  if (process.platform !== 'win32') {
    expect((await fs.stat(target)).mode & 0o777).toBe(0o755)
  }
  expect(await fs.readdir(directory)).toEqual(['source.ts'])
})

it.each(['ambiguous', 'missing', 'overlap', 'stale'])(
  'leaves the original file intact for a %s patch',
  async (reason) => {
    const original = 'first first\nsecond\n'
    const target = await fixture(original)
    const secondChange = reason === 'ambiguous'
      ? { oldText: 'first', newText: 'other' }
      : reason === 'missing'
        ? { oldText: 'absent', newText: 'other' }
        : { oldText: 'irst first', newText: 'other' }
    await expect(patchTextFile(target, [
      { oldText: 'first first', newText: 'changed' },
      secondChange
    ], reason === 'stale' ? { expectedContentHash: '0'.repeat(64) } : {})).rejects.toThrow()
    expect(await fs.readFile(target, 'utf8')).toBe(original)
    expect(await fs.readdir(directory)).toEqual(['source.ts'])
  }
)

it('rejects binary text and aliases, and bounds large replacement previews', async () => {
  const target = await fixture('a'.repeat(20_000))
  const result = await patchTextFile(target, [
    { oldText: 'a'.repeat(20_000), newText: 'b'.repeat(20_000) }
  ])
  expect(String(result['diff']).length).toBeLessThanOrEqual(8_000)
  expect(result['diffTruncated']).toBe(true)
  await fs.writeFile(target, 'invalid\0text')
  await expect(patchTextFile(target, [{ oldText: 'text', newText: 'code' }])).rejects.toThrow()
  if (process.platform !== 'win32') {
    const alias = path.join(directory, 'alias.ts')
    await fs.symlink(target, alias)
    await expect(patchTextFile(alias, [{ oldText: 'text', newText: 'code' }])).rejects.toThrow()
  }
})
