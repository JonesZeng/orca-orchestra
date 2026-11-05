# Security model

Orchestra is a `trusted-worker` plugin: it can do anything your user can do. This document states
what it actually does, so you can decide whether to approve it.

## Execution profile

The manifest declares `execution: "trusted-worker"` and asks for no additional host
`capabilities`. Its worker (`worker/main.mjs`) is a separate Node process running with your user
permissions, outside Orca's sandbox. The panel (`panel.html`) is an inline-only HTML document
loaded by Orca; it cannot read files, spawn processes or open network connections.

Approve the plugin only if you trust where the package came from. `orca plugin validate` checks
the package offline and never runs it; approval is a separate decision.

## Local host

For **This computer**, the worker locates the Orca runtime metadata for the current profile (a
local socket or named pipe and its token), pins it by `userDataPath` and `runtimeId`, and makes
only the orchestration reads and the confirmed orchestration writes listed in the README. A
refused local connection is retried once against that same runtime only.

## Saved servers

For a **saved server**, the worker:

- reads Orca's server registry (`<userData>/orca-environments.json`) to list names and ids. It
  never writes the registry and never scans the network.
- resolves the selected id to the saved device token and pinned host key, and connects over
  Orca's existing end-to-end-encrypted WebSocket client (`worker/orchestra-remote.cjs`, generated
  from this repository's `src/shared/remote-runtime`).
- accepts only `{kind: "local"}` or `{kind: "environment", id}` from the panel. A URL, path,
  empty or oversized id, or any other kind is refused by the gateway and again by the worker, so
  the panel can never name an endpoint.
- sends the panel only a server id and name — never an endpoint, device token, pairing token or
  host key.

Tunnel-backed (SSH/WSL/managed) servers work only while Orca keeps the tunnel open. The worker
cannot start a tunnel; it reports that the server is unreachable and suggests opening it in Orca.

## Writes

Every mutation is previewed with the exact target and parameters, then confirmed. Before sending,
the panel runs a `status.get` orchestration-capability preflight for that panel **and** that host.
A missing, stale, reused or different-runtime preflight is refused before anything is sent; a local
preflight cannot authorize a remote write and vice versa.

Each confirmed write carries a durable request id. If the reply is lost, the panel says completion
may be unknown, shows the request id, and offers read-only receipt lookup. It never retries a
write automatically. Remote writes are one-shot; a response from a different runtime is not
accepted as confirmation.

Terminal handles and run ids belong to the selected server. The only terminal write is the
confirmed dispatch, which injects the task prompt into the target agent terminal; the runtime
refuses a plain terminal unless a supported agent is detected there.

## Panel isolation

`panel.html` is one self-contained document: inline CSS, JavaScript and the Geist font, no CDN
assets and no external requests. It follows Orca's locale and theme tokens. It has no telemetry.
Only the worker opens network connections, and only to servers you already saved and selected.

## What the plugin does not do

- No worker lifecycle operations (`workerStart`, `workerShow`), gate creation, resets, arbitrary
  runtime RPC, or arbitrary terminal input.
- No discovery of new servers or endpoints.
- No background work when the panel is closed.
- No mobile or browser-client panel; those keep the existing Orchestra WebUI.

## Package provenance

`worker/orchestra-remote.cjs` is generated at build time from Orca's own remote-runtime client —
not hand-copied E2EE code — and bundles only `ws`, `tweetnacl`, `zod` and Node built-ins. See
`THIRD_PARTY_NOTICES.md`. The package contains no credentials, tokens, user paths, live run
identifiers or demo data. Review the readable worker sources in `worker/` before approving.

## Reporting

Open a private security advisory on the repository rather than a public issue, and include the
plugin version and the command or file involved.
