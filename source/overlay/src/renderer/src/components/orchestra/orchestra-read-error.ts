import { z } from 'zod'
import { translate } from '@/i18n/i18n'

export function orchestraReadError(failure: unknown): string {
  return failure instanceof z.ZodError
    ? translate(
        'orchestra.data.incompatible',
        'Unexpected runtime response. Check that the client and server versions are compatible.'
      )
    : failure instanceof Error
      ? failure.message
      : translate('orchestra.data.readFailed', 'Could not read orchestration state.')
}
