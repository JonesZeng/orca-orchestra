import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  buildOrchestraMutation,
  orchestraActionCopy,
  type OrchestraActionRequest,
  type OrchestraActionValues,
  type OrchestraMutationDraft
} from './orchestra-actions'

export type OrchestraActionSheetProps = {
  request: OrchestraActionRequest | null
  runId: string | null
  coordinator: string
  disabled: boolean
  onClose: () => void
  onPreview: (draft: OrchestraMutationDraft) => void
}

function OrchestraActionForm({
  request,
  runId,
  coordinator,
  disabled,
  onClose,
  onPreview
}: Omit<OrchestraActionSheetProps, 'request'> & {
  request: OrchestraActionRequest
}): React.JSX.Element {
  useTranslation()
  const id = useId()
  const copy = orchestraActionCopy(request)
  const [values, setValues] = useState<OrchestraActionValues>((): OrchestraActionValues =>
    request.kind === 'message' ? { to: request.to ?? '' } : {}
  )
  const [error, setError] = useState<{ message: string; field?: string } | null>(null)
  const setField = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }))
    setError(null)
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{copy.title}</SheetTitle>
        <SheetDescription>{copy.description}</SheetDescription>
      </SheetHeader>
      <form
        className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (disabled) {
            return
          }
          const result = buildOrchestraMutation(request, values, { runId, coordinator })
          if (!result.ok) {
            setError({ message: result.error, field: result.field })
            return
          }
          onPreview(result.draft)
        }}
      >
        <dl className="space-y-2 rounded-md border border-border p-3 text-xs">
          <div>
            <dt className="text-muted-foreground">
              {translate('orchestra.actions.coordinator', 'Coordinator')}
            </dt>
            <dd className="mt-1 break-all font-mono">
              {coordinator.trim() || translate('orchestra.actions.unspecified', 'Not specified')}
            </dd>
          </div>
          {request.kind !== 'run' && (
            <div>
              <dt className="text-muted-foreground">
                {translate('orchestra.actions.currentRun', 'Current run')}
              </dt>
              <dd className="mt-1 break-all font-mono">
                {runId || translate('orchestra.actions.unselected', 'Not selected')}
              </dd>
            </div>
          )}
        </dl>
        <fieldset disabled={disabled} className="flex flex-col gap-5">
          {request.kind === 'gate' && request.options.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'orchestra.actions.suggestedOptions',
                  'Suggested responses (select one, then add details if needed)'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {[...new Set(request.options)].map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setField('resolution', option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {copy.fields.map((field) => {
            const fieldId = `${id}-${field.name}`
            const invalid = error?.field === field.name
            const props = {
              id: fieldId,
              name: field.name,
              value: values[field.name] ?? '',
              required: !field.optional,
              'aria-invalid': invalid,
              'aria-describedby': invalid
                ? `${id}-error`
                : field.hint
                  ? `${fieldId}-hint`
                  : undefined,
              onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setField(field.name, event.target.value)
            }
            return (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={fieldId}>
                  {field.label}
                  {field.optional ? translate('orchestra.actions.optional', ' (optional)') : ''}
                </Label>
                {field.multiline ? (
                  <Textarea {...props} rows={5} />
                ) : (
                  <Input {...props} autoComplete="off" />
                )}
                {field.hint && (
                  <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
                    {field.hint}
                  </p>
                )}
              </div>
            )
          })}
        </fieldset>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {translate(
            'orchestra.actions.previewHint',
            'The next step only previews the request. Nothing is sent until you confirm.'
          )}
        </p>
        <div className="mt-auto flex justify-end gap-2 pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {translate('orchestra.actions.cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={disabled || !coordinator.trim()}>
            {translate('orchestra.actions.preview', 'Preview operation')} <ArrowRight aria-hidden />
          </Button>
        </div>
      </form>
    </>
  )
}

export function OrchestraActionSheet(props: OrchestraActionSheetProps): React.JSX.Element {
  return (
    <Sheet
      open={props.request !== null}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose()
        }
      }}
    >
      <SheetContent>
        {props.request && (
          <OrchestraActionForm
            key={JSON.stringify([props.request, props.runId, props.coordinator])}
            {...props}
            request={props.request}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
