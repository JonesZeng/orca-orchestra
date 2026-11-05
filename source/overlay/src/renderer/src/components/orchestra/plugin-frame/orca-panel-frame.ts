/** The parts of the frozen `window.orca` an Orca plugin panel frame gets (host API 1.2, Orca 1.4.246+). */
export type OrcaPanelFrame = {
  /** Orca's UI language once the host has said hello; the browser's until then. */
  readonly locale: string
  host: {
    call(method: string, params?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
    has(method: string): boolean
  }
  on(event: string, handler: (payload: unknown) => void): { dispose(): void }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function field(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined
}

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    /** Present only inside an Orca plugin panel frame. */
    orca?: unknown
  }
}

/** Null outside an Orca panel frame, e.g. when the page is opened directly. */
export function readOrcaPanelFrame(source: unknown = window.orca): OrcaPanelFrame | null {
  const host = field(source, 'host')
  const call = field(host, 'call')
  const has = field(host, 'has')
  const on = field(source, 'on')
  if (typeof call !== 'function' || typeof has !== 'function' || typeof on !== 'function') {
    return null
  }
  return {
    get locale() {
      const locale = field(source, 'locale')
      return typeof locale === 'string' && locale ? locale : navigator.language
    },
    host: {
      call: (method, params, options) => Promise.resolve(call.call(host, method, params, options)),
      has: (method) => has.call(host, method) === true
    },
    on: (event, handler) => {
      const subscription: unknown = on.call(source, event, handler)
      return {
        dispose: () => {
          const dispose = field(subscription, 'dispose')
          if (typeof dispose === 'function') {
            dispose.call(subscription)
          }
        }
      }
    }
  }
}
