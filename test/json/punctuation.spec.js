import fs from 'fs'
import path from 'path'

describe('punctuation', () => {
  const rootFolders = [
    'packages'
  ]
  const punctuations = ['.', ';', ':', '?', '!', '>']
  const findPunctuation = (s) => punctuations.includes(s[s.length - 1])
  const findString = (iterable) => {
    const keys = Object.keys(iterable)

    for (let i = 0; i < keys.length; i += 1) {
      // Continue to dig if this is not a sentence
      if (typeof iterable[keys[i]] !== 'string') {
        findString(iterable[keys[i]])
      } else {
        const s = iterable[keys[i]]
        const found = findPunctuation(s)

        test(`has punctuation at the end of "${s}"`, () => {
          expect(found).toBe(true)
        })
      }
    }
  }
  const list = (dir) => {
    const entities = fs.readdirSync(dir)

    // Browse dir entities
    for (let i = 0; i < entities.length; i += 1) {
      // Recursive if the entity is a directory
      const way = path.join(dir, entities[i])
      if (fs.statSync(way).isDirectory()) {
        list(way)
      } else if (way.indexOf('data/answers') !== -1
        && entities[i].indexOf('.json') !== -1) {
        const jsonFile = path.join(global.paths.root, dir, entities[i])
        const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))

        describe(jsonFile, () => {
          findString(json)
        })
      }
    }
  }

  for (let i = 0; i < rootFolders.length; i += 1) {
    list(rootFolders[i])
  }
})
