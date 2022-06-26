import fs from 'fs'
import path from 'path'

const json = { }

json.loadNluData = async (nluFilePath, lang) => {
  const sharedDataPath = path.join(process.cwd(), 'core/data', lang)
  const nluData = JSON.parse(fs.readFileSync(nluFilePath, 'utf8'))
  const { entities } = nluData

  // Load shared data entities if entity = 'xxx.json'
  if (entities) {
    const entitiesKeys = Object.keys(entities)

    entitiesKeys.forEach((entity) => {
      if (typeof entities[entity] === 'string') {
        entities[entity] = JSON.parse(fs.readFileSync(path.join(sharedDataPath, entities[entity]), 'utf8'))
      }
    })

    nluData.entities = entities
  }

  return nluData
}

export default json
