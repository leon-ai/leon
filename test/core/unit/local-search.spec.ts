import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { localSearchScope } from '@@/bridges/runtime/nodejs/local-search'

const root = path.resolve('workspace')
const remote = path.join(root, 'remote')
const local = path.join(root, 'remote-notes')

describe('local search scope', () => {
  it('keeps local siblings available when a requested folder contains remote storage', () => {
    const scope = localSearchScope([root], [remote], true)
    const relative = path.relative(path.parse(root).root, remote).split(path.sep).join('/')

    expect(scope.paths).toEqual([root])
    expect(scope.excluded).toEqual([remote])
    expect(scope.globs).toEqual([`!/${relative}`])
  })

  it('skips a remote starting folder and keeps an unrelated local folder', () => {
    const nested = path.join(remote, 'notes')
    expect(localSearchScope([nested, local], [remote], true)).toEqual({
      paths: [local], excluded: [nested], globs: []
    })
  })

  it('keeps an unguarded indexer away from a root containing remote storage', () => {
    expect(localSearchScope([root, local], [remote], false)).toEqual({
      paths: [local], excluded: [root], globs: []
    })
  })
})
