import { z } from 'zod'

/** A host the panel can observe: this Orca, or one saved paired server. */
export type OrchestraTarget =
  | { kind: 'local'; id: 'local' }
  | {
      kind: 'environment'
      id: string
      name: string
      lastUsedAt: number | null
      requiresTunnel: boolean
    }

export type OrchestraTargetsAnswer = {
  targets: OrchestraTarget[]
  warning?: string
}

export const LOCAL_ORCHESTRA_TARGET: OrchestraTarget = { kind: 'local', id: 'local' }

const EnvironmentTargetSchema = z.object({
  kind: z.literal('environment'),
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(200),
  lastUsedAt: z.number().finite().nullable().optional(),
  requiresTunnel: z.boolean().optional()
})
const TargetsAnswerSchema = z.object({
  targets: z.array(z.unknown()).max(100),
  warning: z.string().max(64).optional()
})

/** Unknown or malformed rows are dropped; the panel always keeps this Orca as a target. */
export function parseOrchestraTargets(value: unknown): OrchestraTargetsAnswer {
  const parsed = TargetsAnswerSchema.safeParse(value)
  if (!parsed.success) {
    return { targets: [LOCAL_ORCHESTRA_TARGET] }
  }
  const targets: OrchestraTarget[] = [LOCAL_ORCHESTRA_TARGET]
  const seen = new Set<string>(['local'])
  for (const row of parsed.data.targets) {
    const environment = EnvironmentTargetSchema.safeParse(row)
    if (!environment.success || seen.has(environment.data.id)) {
      continue
    }
    seen.add(environment.data.id)
    targets.push({
      kind: 'environment',
      id: environment.data.id,
      name: environment.data.name,
      lastUsedAt: environment.data.lastUsedAt ?? null,
      requiresTunnel: environment.data.requiresTunnel === true
    })
  }
  return {
    targets,
    ...(parsed.data.warning ? { warning: parsed.data.warning } : {})
  }
}

/** Stable key for the selector and for remounting the page on a target switch. */
export function orchestraTargetKey(target: OrchestraTarget): string {
  return target.kind === 'local' ? 'local' : `environment:${target.id}`
}

/** The wire shape the worker re-validates; no endpoint or credential ever comes from the panel. */
export function orchestraTargetRequest(
  target: OrchestraTarget
): { kind: 'local' } | { kind: 'environment'; id: string } {
  return target.kind === 'local' ? { kind: 'local' } : { kind: 'environment', id: target.id }
}
