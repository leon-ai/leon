import { Router } from 'express'

import downloadController from '@/api/downloads/download.controller'

const downloadRouter = Router()

// Get downloads to download module content
downloadRouter.get('/', downloadController.get)

export default downloadRouter
