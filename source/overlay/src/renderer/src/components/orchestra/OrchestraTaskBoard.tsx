import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { ArrowRight, GitBranch, ListTodo, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OrchestraTask } from './orchestra-model'
import type { OrchestraActionRequest } from './orchestra-actions'

export function taskTitle(task: OrchestraTask): string {
  return task.display_name || task.task_title || task.spec.split('\n')[0] || task.id
}

export function OrchestraTaskBoard({
  tasks,
  disabled,
  onAction
}: {
  tasks: OrchestraTask[]
  disabled: boolean
  onAction: (request: OrchestraActionRequest) => void
}): React.JSX.Element {
  useTranslation()
  const COLUMNS = [
    {
      title: translate('orchestra.tasks.columnWaiting', 'Waiting on dependencies'),
      states: ['pending', 'blocked']
    },
    { title: translate('orchestra.tasks.columnReady', 'Ready to dispatch'), states: ['ready'] },
    { title: translate('orchestra.tasks.columnRunning', 'In progress'), states: ['dispatched'] },
    {
      title: translate('orchestra.tasks.columnFinished', 'Finished'),
      states: ['completed', 'failed']
    }
  ] as const

  const STATUS_LABELS: Record<string, string> = {
    pending: translate('orchestra.tasks.statusPending', 'Pending'),
    blocked: translate('orchestra.tasks.statusBlocked', 'Blocked'),
    ready: translate('orchestra.tasks.statusReady', 'Ready'),
    dispatched: translate('orchestra.tasks.statusDispatched', 'Dispatched'),
    completed: translate('orchestra.tasks.statusCompleted', 'Completed'),
    failed: translate('orchestra.tasks.statusFailed', 'Failed')
  }

  const names = new Map(tasks.map((task) => [task.id, taskTitle(task)]))
  if (!tasks.length) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-8 text-center">
        <ListTodo className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="font-medium">
            {translate('orchestra.tasks.emptyTitle', 'Add the first task to this Run')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {translate(
              'orchestra.tasks.emptyDescription',
              'Break the objective into tasks and use dependencies to control their order. Creating a task does not start an agent.'
            )}
          </p>
        </div>
        <Button variant="outline" disabled={disabled} onClick={() => onAction({ kind: 'task' })}>
          <Plus />
          {translate('orchestra.tasks.add', 'Add task')}
        </Button>
      </div>
    )
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((column) => {
        const rows = tasks.filter((task) => column.states.some((status) => status === task.status))
        return (
          <section key={column.states[0]} aria-label={column.title} className="min-w-0">
            <h3 className="mb-3 flex items-center justify-between text-xs font-semibold text-muted-foreground">
              <span>{column.title}</span>
              <Badge variant="outline">{rows.length}</Badge>
            </h3>
            <div className="flex flex-col gap-3">
              {rows.map((task) => (
                <Card key={task.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={task.status === 'failed' ? 'destructive' : 'secondary'}>
                        {STATUS_LABELS[task.status] ?? task.status}
                      </Badge>
                    </div>
                    <CardTitle className="break-words">{taskTitle(task)}</CardTitle>
                    <p className="truncate font-mono text-2xs text-muted-foreground">{task.id}</p>
                  </CardHeader>
                  <CardContent>
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer text-foreground">
                        {translate('orchestra.tasks.specification', 'Task description')}
                      </summary>
                      <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words scrollbar-sleek">
                        {task.spec}
                      </p>
                    </details>
                    {task.deps.length > 0 && (
                      <div className="mt-4 border-t border-border pt-3">
                        <p className="mb-2 flex items-center gap-1 text-2xs text-muted-foreground">
                          <GitBranch className="size-3" aria-hidden />
                          {translate('orchestra.tasks.dependencies', 'Dependencies')}
                        </p>
                        <ul className="space-y-1 text-xs">
                          {task.deps.map((dep) => (
                            <li key={dep} className="break-words">
                              ↳ {names.get(dep) ?? dep}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {task.assignee_handle && (
                      <p className="mt-3 break-all font-mono text-2xs text-muted-foreground">
                        → {task.assignee_handle}
                      </p>
                    )}
                    {task.result && (
                      <details className="mt-3 text-xs">
                        <summary className="cursor-pointer">
                          {translate('orchestra.tasks.result', 'Result')}
                        </summary>
                        <p className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words scrollbar-sleek">
                          {task.result}
                        </p>
                      </details>
                    )}
                    {task.status === 'ready' && (
                      <div className="mt-4">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() =>
                            onAction({
                              kind: 'dispatch',
                              taskId: task.id,
                              taskTitle: taskTitle(task)
                            })
                          }
                        >
                          <ArrowRight />
                          {translate('orchestra.tasks.dispatch', 'Dispatch to agent')}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {!rows.length && (
                <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                  {translate('orchestra.tasks.emptyColumn', 'No tasks')}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
