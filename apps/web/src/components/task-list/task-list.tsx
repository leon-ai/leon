import type { ReactNode } from 'react'
import type { FeedPlanStep, LeonFeedActivity } from '@/data/feed'
import { TaskListItem } from '@/components/task-list-item'

import './task-list.sass'

interface TaskListProps {
  steps: FeedPlanStep[]
  renderActivity?: (activity: LeonFeedActivity) => ReactNode
}

export function TaskList({ steps, renderActivity }: TaskListProps) {
  return (
    <ol className="task-list" aria-label="Execution plan">
      {steps.map((step, index) => (
        <TaskListItem key={`${step.id}:${index}`} step={step} renderActivity={renderActivity} />
      ))}
    </ol>
  )
}
