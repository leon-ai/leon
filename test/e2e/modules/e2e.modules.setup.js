'use strict'

import 'jest-extended'
import moment from 'moment-timezone'

import Nlu from '@/core/nlu'
import Brain from '@/core/brain'

jest.setTimeout(60000)

global.nlu = new Nlu()
global.brain = new Brain({ emit: jest.fn() }, 'en')
global.nlu.brain = { wernicke: jest.fn(), talk: jest.fn(), socket: { emit: jest.fn() } }
global.brain.tts = {
  synthesizer: jest.fn(),
  save: jest.fn(),
  add: jest.fn()
}

global.date = {
  time_zone: moment.tz.guess()
}

process.env.LEON_LANG = 'en-US'
process.env.LEON_NODE_ENV = 'testing'
process.env.LEON_TIME_ZONE = global.date.time_zone

beforeAll(async () => {
  await global.nlu.loadModel(global.paths.classifier)
})
