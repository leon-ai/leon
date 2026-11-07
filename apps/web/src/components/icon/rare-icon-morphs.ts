import { DIAGRAM_VIEW_MORPH } from './diagram-view-morph'
import type { MorphFrames } from './icon-morphs'

export const RARE_ICON_MORPHS: Record<string, MorphFrames> = {
  'diagram-view': DIAGRAM_VIEW_MORPH,
  'list-selection': {
    'idle': [
      {
        'points': [3,6,3,6,4.5,7.5,4.5,7.5,4.5,7.5,7,5,7,5],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [10,6,10,6,21,6,21,6],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [3,12,3,12,7,12,7,12],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [10,12,10,12,21,12,21,12],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [3,18,3,18,7,18,7,18],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [10,18,10,18,21,18,21,18],
        'opacity': 1,
        'fill': 0
      }
    ],
    'selected': [
      {
        'points': [2.5,6,2.5,6,4.5,8,4.5,8,4.5,8,7.5,4.5,7.5,4.5],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [10,6,10,6,21.5,6,21.5,6],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [3,12,3,12,7,12,7,12],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [10,12,10,12,21.5,12,21.5,12],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [3,18,3,18,7,18,7,18],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [10,18,10,18,21.5,18,21.5,18],
        'opacity': 1,
        'fill': 0
      }
    ]
  },
  'column-selection': {
    'idle': [
      {
        'points': [6,3,6,3,18,3,18,3,19.65685,3,21,4.34315,21,6,21,6,21,18,21,18,21,19.65685,19.65685,21,18,21,18,21,6,21,6,21,4.34315,21,3,19.65685,3,18,3,18,3,6,3,6,3,4.34315,4.34315,3,6,3],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [12,3,12,3,12,21,12,21],
        'opacity': 1,
        'fill': 0
      }
    ],
    'selected': [
      {
        'points': [7.5,3,7.5,3,16.5,3,16.5,3,18.98528,3,21,5.01472,21,7.5,21,7.5,21,16.5,21,16.5,21,18.98528,18.98528,21,16.5,21,16.5,21,7.5,21,7.5,21,5.01472,21,3,18.98528,3,16.5,3,16.5,3,7.5,3,7.5,3,5.01472,5.01472,3,7.5,3],
        'opacity': 1,
        'fill': 0
      },
      {
        'points': [11,3,11,3,11,21,11,21],
        'opacity': 1,
        'fill': 0
      }
    ]
  }
}
