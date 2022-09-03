import fs from 'fs'
import path from 'path'

const json = {}

json.loadConfigData = async (configFilePath, lang) => {
  const sharedDataPath = path.join(process.cwd(), 'core/data', lang)
  const configData = JSON.parse(fs.readFileSync(configFilePath, 'utf8'))
  const { entities } = configData

  // Load shared data entities if entity = 'xxx.json'
  if (entities) {
    const entitiesKeys = Object.keys(entities)

    entitiesKeys.forEach((entity) => {
      if (typeof entities[entity] === 'string') {
        entities[entity] = JSON.parse(
          fs.readFileSync(path.join(sharedDataPath, entities[entity]), 'utf8')
        )
      }
    })

    configData.entities = entities
  }

  return configData
}

export default json
