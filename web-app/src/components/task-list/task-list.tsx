import type { FeedPlanStep } from '../../data/feed'
import { TaskListItem } from '../task-list-item'

import './task-list.sass'

interface TaskListProps {
  steps: FeedPlanStep[]
}

export function TaskList({ steps }: TaskListProps) {
  return (
    <ol className="task-list" aria-label="Execution plan">
      {steps.map((step) => (
        <TaskListItem key={step.id} step={step} />
      ))}
    </ol>
  )
}
