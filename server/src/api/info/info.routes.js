'use strict'

import { Router } from 'express'

import infoController from '@/api/info/info.controller'

const infoRouter = Router()

// Get information to init client
infoRouter.get('/', infoController.get)

export default infoRouter
