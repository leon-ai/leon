import fs from 'fs'
import path from 'path'
import { command } from 'execa'

import Nlu from '@/core/nlu'
import Brain from '@/core/brain'

/**
 * This test will test the Leon's NLP (Natural Language Processing):
 * 1. Browse every expression for each module
 * 2. Check if it matches its respective module
 *
 * Do not forget to train your expressions after this test (already included in e2e npm script)
 */

jest.setTimeout(60000) // Specify jest.setTimeout here as this test does not have config file

describe('NLU modules', () => {
  const { langs } = JSON.parse(fs.readFileSync(path.join(global.paths.root, 'core', 'langs.json'), 'utf8'))
  const langKeys = Object.keys(langs)
  const packages = fs.readdirSync(global.paths.packages)
    .filter((entity) => fs.statSync(path.join(global.paths.packages, entity)).isDirectory())

  for (let i = 0; i < langKeys.length; i += 1) {
    // eslint-disable-next-line no-loop-func
    describe(`${langKeys[i]} language`, () => {
      const lang = langs[langKeys[i]]
      const nlu = new Nlu()
      const brain = new Brain({ emit: jest.fn() }, lang.short)
      let expressionsObj = { }

      nlu.brain = { wernicke: jest.fn(), talk: jest.fn(), socket: { emit: jest.fn() } }
      brain.talk = jest.fn()

      beforeAll(async () => {
        process.env.LEON_LANG = langKeys[i]

        // Generate new NLP model for the tested language
        await command(`npm run train expressions:${lang.short}`, { shell: true })
        // Load the new NLP model
        await nlu.loadModel(global.paths.nlp_model)
      })

      for (let j = 0; j < packages.length; j += 1) {
        // eslint-disable-next-line no-loop-func
        describe(`${packages[j]} package`, () => {
          const expressionsFile = `${global.paths.packages}/${packages[j]}/data/expressions/${lang.short}.json`
          expressionsObj = JSON.parse(fs.readFileSync(expressionsFile, 'utf8'))

          const modules = Object.keys(expressionsObj)
          for (let k = 0; k < modules.length; k += 1) {
            const module = modules[k]
            const actions = Object.keys(expressionsObj[module])

            // eslint-disable-next-line no-loop-func
            describe(`${module} module`, () => {
              for (let l = 0; l < actions.length; l += 1) {
                const action = actions[l]
                const exprs = expressionsObj[module][action].expressions

                for (let m = 0; m < exprs.length; m += 1) {
                  // eslint-disable-next-line no-loop-func
                  test(`"${exprs[m]}" queries this module`, async () => {
                    // Need to redefine the NLU brain execution to update the mocking
                    nlu.brain.execute = jest.fn()

                    await nlu.process(exprs[m])
                    const [obj] = nlu.brain.execute.mock.calls

                    expect(obj[0].classification.package).toBe(packages[j])
                    expect(obj[0].classification.module).toBe(module)
                  })
                }
              }
            })
          }
        })
      }
    })
  }
})
