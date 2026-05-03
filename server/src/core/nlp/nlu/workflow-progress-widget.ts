import { emitPlanWidget, widgetId } from '@/core/llm-manager/llm-duties/react-llm-duty/plan-widget'
import type { TrackedPlanStep } from '@/core/llm-manager/llm-duties/react-llm-duty/types'
import { RoutingMode } from '@/types'

type WorkflowBaseStep = 'routing' | 'choosing_skill' | 'picking_action' | 'resolving_parameters'

/**
 * Tracks and renders workflow progress using the same widget system as agent planning.
 * The widget keeps base workflow phases plus dynamic per-action execution steps.
 */
export class WorkflowProgressWidget {
  private id: string | null = null
  private routingMode: RoutingMode = RoutingMode.Controlled
  private hasPendingAction = false
  private currentBaseStep: WorkflowBaseStep | null = null
  private actionLabels: string[] = []
  private currentActionIndex: number | null = null

  public startTurn(
    routingMode: RoutingMode,
    hasPendingAction: boolean
  ): void {
    this.id = null
    this.routingMode = routingMode
    this.hasPendingAction = hasPendingAction
    this.currentBaseStep = this.getInitialBaseStep(routingMode, hasPendingAction)
    this.actionLabels = []
    this.currentActionIndex = null

    this.emit(false)
  }

  public showChoosingSkill(): void {
    this.currentBaseStep = 'choosing_skill'
    this.emit()
  }

  public showPickingAction(): void {
    this.currentBaseStep = 'picking_action'
    this.emit()
  }

  public showResolvingParameters(): void {
    this.currentBaseStep = 'resolving_parameters'
    this.emit()
  }

  public startAction(actionName: string): void {
    const label = `Running ${actionName} action...`
    const existingIndex = this.actionLabels.indexOf(label)

    this.currentBaseStep = null

    if (existingIndex === -1) {
      this.actionLabels.push(label)
      this.currentActionIndex = this.actionLabels.length - 1
    } else {
      this.currentActionIndex = existingIndex
    }

    this.emit()
  }

  public completeRoutingOnly(): void {
    this.actionLabels = []
    this.currentActionIndex = null
    this.emitStatic([{ label: 'Routing...', status: 'completed' }])
  }

  public completeSelectionNotFound(): void {
    this.currentBaseStep = null
    this.actionLabels = []
    this.currentActionIndex = null
    this.emit()
  }

  public completeAll(): void {
    this.currentBaseStep = null
    this.currentActionIndex = null

    this.emit()
  }

  public reset(): void {
    this.id = null
    this.currentBaseStep = null
    this.actionLabels = []
    this.currentActionIndex = null
  }

  private getInitialBaseStep(
    routingMode: RoutingMode,
    hasPendingAction: boolean
  ): WorkflowBaseStep | null {
    if (routingMode === RoutingMode.Agent) {
      return null
    }

    if (hasPendingAction) {
      return routingMode === RoutingMode.Smart ? 'routing' : 'resolving_parameters'
    }

    return routingMode === RoutingMode.Smart ? 'routing' : 'choosing_skill'
  }

  private getBaseLabels(): string[] {
    if (this.routingMode === RoutingMode.Agent) {
      return []
    }

    if (this.hasPendingAction) {
      const labels: string[] = []

      if (this.routingMode === RoutingMode.Smart) {
        labels.push('Routing...')
      }

      labels.push('Resolving parameters...')

      return labels
    }

    const labels: string[] = []

    if (this.routingMode === RoutingMode.Smart) {
      labels.push('Routing...')
    }

    labels.push('Choosing skill...')
    labels.push('Picking action...')

    return labels
  }

  private getBaseStepIndex(
    labels: string[],
    step: WorkflowBaseStep | null
  ): number | null {
    if (!step) {
      return null
    }

    const stepLabelMap: Record<WorkflowBaseStep, string> = {
      routing: 'Routing...',
      choosing_skill: 'Choosing skill...',
      picking_action: 'Picking action...',
      resolving_parameters: 'Resolving parameters...'
    }

    const index = labels.indexOf(stepLabelMap[step])

    return index === -1 ? null : index
  }

  private buildSteps(): TrackedPlanStep[] {
    const baseLabels = this.getBaseLabels()
    const activeBaseIndex = this.getBaseStepIndex(baseLabels, this.currentBaseStep)
    const baseSteps = baseLabels.map((label, index) => ({
      label,
      status:
        activeBaseIndex === null
          ? 'completed'
          : index < activeBaseIndex
            ? 'completed'
            : index === activeBaseIndex
              ? 'in_progress'
              : 'pending'
    })) as TrackedPlanStep[]

    const actionSteps = this.actionLabels.map((label, index) => ({
      label,
      status:
        this.currentActionIndex === null
          ? 'completed'
          : index < this.currentActionIndex
            ? 'completed'
            : index === this.currentActionIndex
              ? 'in_progress'
              : 'pending'
    })) as TrackedPlanStep[]

    return [...baseSteps, ...actionSteps]
  }

  private emit(isUpdate = true): void {
    const steps = this.buildSteps()

    this.emitStatic(steps, isUpdate)
  }

  private emitStatic(steps: TrackedPlanStep[], isUpdate = true): void {
    if (steps.length === 0) {
      return
    }

    if (!this.id) {
      this.id = widgetId('workflow-progress')
    }

    emitPlanWidget(steps, null, this.id, isUpdate)
  }
}
