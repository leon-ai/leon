import fs from 'fs'
import path from 'path'

describe('are JSON files valid', () => {
  const rootFolders = ['core', 'packages', 'core/config', 'server/src/data']
  const list = (dir) => {
    const entities = fs.readdirSync(dir)

    // Browse dir entities
    for (let i = 0; i < entities.length; i += 1) {
      // Recursive if the entity is a directory
      const way = path.join(dir, entities[i])
      if (fs.statSync(way).isDirectory()) {
        list(way)
      } else if (entities[i].indexOf('.json') !== -1) {
        const jsonFile = path.join(global.paths.root, dir, entities[i])
        test(`${jsonFile} has valid JSON syntax`, () => {
          try {
            // eslint-disable-line no-useless-catch
            JSON.parse(fs.readFileSync(jsonFile, 'utf8'))

            expect(true).toBe(true)
          } catch (e) {
            throw e
          }
        })
      }
    }
  }

  for (let i = 0; i < rootFolders.length; i += 1) {
    list(rootFolders[i])
  }
})
