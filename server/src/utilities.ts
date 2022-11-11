import path from 'node:path'

import type { ShortLanguageCode } from '@/helpers/lang-helper'
import { GLOBAL_DATA_PATH } from '@/constants'

/**
 * Paths
 */
export function getGlobalEntitiesPath(lang: ShortLanguageCode): string {
  return path.join(GLOBAL_DATA_PATH, lang, 'global-entities')
}
export function getGlobalResolversPath(lang: ShortLanguageCode): string {
  return path.join(GLOBAL_DATA_PATH, lang, 'global-resolvers')
}
