// Share matching with Core without importing its runtime services.
export {
  createSearchIndex,
  getSearchSegments,
  getSearchTextSegments,
  searchIndex
} from '../../../../server/src/helpers/search-helper'
export type { SearchSegment } from '../../../../server/src/helpers/search-helper'
