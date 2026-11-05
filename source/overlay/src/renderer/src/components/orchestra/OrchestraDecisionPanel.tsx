import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { CheckCircle2, GitPullRequestArrow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OrchestraGate } from './orchestra-model'
import type { OrchestraActionRequest } from './orchestra-actions'

export function OrchestraDecisionPanel({
  gates,
  disabled,
  onAction
}: {
  gates: OrchestraGate[]
  disabled: boolean
  onAction: (request: OrchestraActionRequest) => void
}): React.JSX.Element {
  useTranslation()
  const pending = gates.filter((gate) => gate.status === 'pending')
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <GitPullRequestArrow className="size-4" aria-hidden />
          <CardTitle>{translate('orchestra.decisions.title', 'Human decisions')}</CardTitle>
          <Badge variant="secondary">{pending.length}</Badge>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'orchestra.decisions.description',
            'Decision gates pause further execution until a resolution is provided.'
          )}
        </p>
      </CardHeader>
      <CardContent>
        {!pending.length && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{translate('orchestra.decisions.empty', 'No decisions are pending.')}</p>
          </div>
        )}
        <div className="space-y-5">
          {pending.map((gate) => (
            <article
              key={gate.id}
              className="space-y-3 border-b border-border pb-5 last:border-b-0 last:pb-0"
            >
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{gate.question}</p>
              <p className="break-all font-mono text-2xs text-muted-foreground">{gate.task_id}</p>
              {gate.options.length > 0 && (
                <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                  {gate.options.map((option, index) => (
                    <li key={`${index}:${option}`}>{option}</li>
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  onAction({
                    kind: 'gate',
                    gateId: gate.id,
                    question: gate.question,
                    options: gate.options
                  })
                }
              >
                {translate('orchestra.decisions.resolve', 'Enter a resolution')}
              </Button>
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
