import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { SearchCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type { OrchestraCall } from './orchestra-model'
import { translate } from '@/i18n/i18n'

const ReceiptSchema = z.object({
  requestId: z.string(),
  state: z.enum(['completed', 'pending', 'absent']),
  interpretation: z.string(),
  method: z.string().optional(),
  receipt: z.unknown().optional()
})

export function OrchestraReceiptInspector({
  call,
  initialRequestId
}: {
  call: OrchestraCall
  initialRequestId: string
}): React.JSX.Element {
  useTranslation()
  const labels = {
    completed: translate('orchestra.receipt.completed', 'Outcome recorded'),
    pending: translate('orchestra.receipt.pending', 'Awaiting outcome'),
    absent: translate('orchestra.receipt.absent', 'No receipt found')
  }
  const [id, setId] = useState(initialRequestId)
  const [receipt, setReceipt] = useState<z.infer<typeof ReceiptSchema> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    []
  )
  async function inspect(): Promise<void> {
    if (!id.trim() || lock.current) {
      return
    }
    const requestedId = id.trim()
    const requestGeneration = generation.current
    lock.current = true
    setBusy(true)
    setReceipt(null)
    setError(null)
    try {
      const value = ReceiptSchema.parse(
        await call('orchestration.requestShow', { request: requestedId })
      )
      if (generation.current !== requestGeneration) {
        return
      }
      if (value.requestId !== requestedId) {
        throw new Error(
          translate(
            'orchestra.receipt.wrongRequest',
            'The runtime returned a receipt for another request; it was not displayed.'
          )
        )
      }
      setReceipt(value)
    } catch (cause) {
      if (generation.current === requestGeneration) {
        setError(
          cause instanceof Error
            ? cause.message
            : translate('orchestra.receipt.readFailed', 'Could not read the receipt')
        )
      }
    } finally {
      lock.current = false
      if (generation.current === requestGeneration) {
        setBusy(false)
      }
    }
  }
  return (
    <section
      className="space-y-3 rounded-md border border-border bg-card p-4 text-card-foreground"
      aria-label={translate('orchestra.receipt.region', 'Request receipt lookup')}
    >
      <Label htmlFor="orchestra-request-id">
        {translate('orchestra.receipt.requestId', 'Look up this request’s receipt')}
      </Label>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void inspect()
        }}
      >
        <Input
          id="orchestra-request-id"
          value={id}
          disabled={busy}
          onChange={(event) => {
            if (lock.current) {
              return
            }
            generation.current++
            setId(event.target.value)
            setReceipt(null)
            setError(null)
          }}
          placeholder={translate(
            'orchestra.receipt.requestIdPlaceholder',
            'requestId from the error message'
          )}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !id.trim()}>
          {busy ? <LoadingSpinner /> : <SearchCheck />}
          {translate('orchestra.receipt.inspect', 'Read receipt')}
        </Button>
      </form>
      <p className="text-xs leading-5 text-muted-foreground">
        {translate(
          'orchestra.receipt.safety',
          'Uses the current pairing identity without executing the request again. A missing receipt does not prove the operation never happened.'
        )}
      </p>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
      {receipt && (
        <div className="space-y-2">
          <Badge variant="outline">{labels[receipt.state]}</Badge>
          <p className="break-words text-xs leading-5">{receipt.interpretation}</p>
          {receipt.receipt !== undefined && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs scrollbar-sleek">
              {JSON.stringify(receipt.receipt, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}
