import { randomUUID } from 'node:crypto'

import { SOCKET_SERVER, TOOLKIT_REGISTRY } from '@/core'

import type { TrackedPlanStep } from './types'

/**
 * Helper to generate a short random ID for widget component IDs.
 */
export const widgetId = (prefix: string): string =>
  `${prefix}-${randomUUID()}`

/**
 * Builds a serialized Aurora component tree for the plan widget.
 * This produces the exact JSON shape the client renderer expects.
 */
export function buildPlanComponentTree(
  steps: TrackedPlanStep[],
  _justCompletedIndex: number | null,
  currentExecutingFunction: string | null = null
): Record<string, unknown> {
  void _justCompletedIndex

  const getToolDisplay = (
    fullFunctionName: string
  ): { name: string, iconName: string, functionName: string } => {
    const segments = fullFunctionName
      .split('.')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
    const toolkitId = segments[0] ?? ''
    const toolId = segments[1] ?? ''
    const functionName = segments.slice(2).join('.') || 'unknown'
    const fallbackToolkitIcon =
      TOOLKIT_REGISTRY.toolkits.find((toolkit) => toolkit.id === toolkitId)?.iconName ||
      'settings-3'

    if (toolkitId && toolId) {
      const resolved = TOOLKIT_REGISTRY.resolveToolById(toolId, toolkitId)
      if (resolved?.toolName) {
        return {
          name: resolved.toolName,
          iconName: resolved.toolIconName || resolved.toolkitIconName,
          functionName
        }
      }
    }

    if (toolId) {
      const resolved = TOOLKIT_REGISTRY.resolveToolById(toolId)
      if (resolved?.toolName) {
        return {
          name: resolved.toolName,
          iconName: resolved.toolIconName || resolved.toolkitIconName,
          functionName
        }
      }
    }

    return {
      name: toolId || fullFunctionName || 'Unknown tool',
      iconName: fallbackToolkitIcon,
      functionName
    }
  }

  const planStepItems = steps.map((step, i) => {
    let child: Record<string, unknown>

    if (step.status === 'in_progress') {
      // Loader + Text
      child = {
        component: 'Flexbox',
        id: widgetId('flexbox'),
        props: {
          alignItems: 'center',
          flexDirection: 'row',
          gap: 'sm',
          children: [
            {
              component: 'Loader',
              id: widgetId('loader'),
              props: {},
              events: []
            },
            {
              component: 'Text',
              id: widgetId('text'),
              props: { children: step.label },
              events: []
            }
          ]
        },
        events: []
      }
    } else if (step.status === 'error') {
      child = {
        component: 'Flexbox',
        id: widgetId('flexbox'),
        props: {
          alignItems: 'center',
          flexDirection: 'row',
          gap: 'sm',
          children: [
            {
              component: 'Icon',
              id: widgetId('icon'),
              props: {
                size: 'sm',
                bgShape: 'circle',
                bgColor: 'transparent-red',
                color: 'red',
                type: 'line',
                iconName: 'close'
              },
              events: []
            },
            {
              component: 'Text',
              id: widgetId('text'),
              props: { children: step.label },
              events: []
            }
          ]
        },
        events: []
      }
    } else {
      // Checkbox
      const isCompleted = step.status === 'completed'
      child = {
        component: 'Checkbox',
        id: widgetId('checkbox'),
        props: {
          name: `step-${i}`,
          label: step.label,
          checked: isCompleted,
          disabled: isCompleted
        },
        events: []
      }
    }

    return {
      component: 'ListItem',
      id: widgetId('listitem'),
      props: {
        align: 'left',
        children: [child]
      },
      events: []
    }
  })

  const areAllStepsCompleted =
    steps.length > 0 && steps.every((step) => step.status === 'completed')

  const executionInfoItem: Record<string, unknown> | null =
    steps.length > 0 && (Boolean(currentExecutingFunction) || areAllStepsCompleted)
      ? ((): Record<string, unknown> => {
          if (areAllStepsCompleted) {
            return {
              component: 'ListItem',
              id: widgetId('listitem'),
              props: {
                align: 'center',
                children: [
                  {
                    component: 'Flexbox',
                    id: widgetId('flexbox'),
                    props: {
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      children: [
                        {
                          component: 'Icon',
                          id: widgetId('icon'),
                          props: {
                            size: 'sm',
                            bgShape: 'circle',
                            bgColor: 'transparent-green',
                            color: 'green',
                            type: 'fill',
                            iconName: 'check'
                          },
                          events: []
                        }
                      ]
                    },
                    events: []
                  }
                ]
              },
              events: []
            }
          }

          const toolDisplay = getToolDisplay(currentExecutingFunction || '')
          const toolStatusText = `${toolDisplay.name} • ${toolDisplay.functionName}`
          const executionInfoChildren: Record<string, unknown>[] = [
            {
              component: 'Status',
              id: widgetId('status'),
              props: {
                iconName: toolDisplay.iconName,
                iconType: 'line',
                children: toolStatusText
              },
              events: []
            }
          ]

          return {
            component: 'ListItem',
            id: widgetId('listitem'),
            props: {
              align: 'center',
              children: [
                {
                  component: 'Flexbox',
                  id: widgetId('flexbox'),
                  props: {
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    gap: 'xs',
                    children: executionInfoChildren
                  },
                  events: []
                }
              ]
            },
            events: []
          }
        })()
      : null
  const listItems = executionInfoItem
    ? [...planStepItems, executionInfoItem]
    : planStepItems

  return {
    component: 'WidgetWrapper',
    id: widgetId('widgetwrapper'),
    props: {
      noPadding: true,
      children: [
        {
          component: 'List',
          id: widgetId('list'),
          props: { children: listItems },
          events: []
        }
      ]
    },
    events: []
  }
}

/**
 * Emits or updates the plan widget via socket. On first call it creates
 * a new message; subsequent calls replace the same message using
 * replaceMessageId so the plan list updates in-place.
 */
export function emitPlanWidget(
  steps: TrackedPlanStep[],
  justCompletedIndex: number | null,
  planWidgetId: string,
  isUpdate: boolean,
  currentExecutingFunction: string | null = null
): void {
  const activeStep =
    steps.find((step) => step.status === 'in_progress') ||
    steps.find((step) => step.status === 'error') ||
    steps[steps.length - 1] ||
    null
  const componentTree = buildPlanComponentTree(
    steps,
    justCompletedIndex,
    currentExecutingFunction
  )
  const widgetData: Record<string, unknown> = {
    id: planWidgetId,
    widget: 'PlanWidget',
    componentTree,
    supportedEvents: [],
    fallbackText: activeStep
      ? activeStep.label
      : 'Working on the current workflow...',
    historyMode: 'system_widget'
  }

  if (isUpdate) {
    widgetData['replaceMessageId'] = planWidgetId
  }

  SOCKET_SERVER.emitAnswerToChatClients(widgetData)
}
