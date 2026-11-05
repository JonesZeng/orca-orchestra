import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { orchestraActionCopy, type OrchestraMutationDraft } from './orchestra-actions'

export function OrchestraConfirmation({
  draft,
  busy,
  disabled,
  coordinator,
  runId,
  onClose,
  onConfirm
}: {
  draft: OrchestraMutationDraft | null
  busy: boolean
  disabled: boolean
  coordinator: string
  runId: string | null
  onClose: () => void
  onConfirm: () => void
}): React.JSX.Element {
  useTranslation()
  const copy = draft?.request ? orchestraActionCopy(draft.request) : null
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose()
        }
      }}
    >
      <DialogContent
        surface="security"
        showCloseButton={!busy}
        onEscapeKeyDown={(event) => {
          if (busy) {
            event.preventDefault()
          }
        }}
        onInteractOutside={(event) => {
          if (busy) {
            event.preventDefault()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate('orchestra.actions.confirmTitle', 'Confirm: {{action}}', {
              action: copy?.title ?? draft?.label ?? ''
            })}
          </DialogTitle>
          <DialogDescription>{copy?.description ?? draft?.description}</DialogDescription>
        </DialogHeader>
        <p className="break-all text-xs text-muted-foreground">
          {translate(
            'orchestra.actions.confirmScope',
            'Coordinator: {{coordinator}} · Run: {{run}}',
            { coordinator, run: runId ?? translate('orchestra.actions.newRun', 'New') }
          )}
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-mono text-xs scrollbar-sleek">
          {draft ? JSON.stringify(draft.params, null, 2) : ''}
        </pre>
        <p className="text-xs leading-5 text-muted-foreground">
          {translate(
            'orchestra.actions.confirmWarning',
            'This runs once, without automatic retries on timeout or disconnect. It may affect an active agent.'
          )}
        </p>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {translate('orchestra.actions.cancel', 'Cancel')}
          </Button>
          <Button disabled={disabled || busy} onClick={onConfirm}>
            {busy ? <LoadingSpinner /> : <ShieldCheck />}
            {busy
              ? translate('orchestra.actions.waiting', 'Waiting for runtime confirmation…')
              : translate('orchestra.actions.confirm', 'Confirm operation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
