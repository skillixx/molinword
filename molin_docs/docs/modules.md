# Module Design

## Modules

### Auth and Session

Owns Moling launch ticket exchange, application session creation, and current-user context.

Second-stage file: `src/app.js` handles the session foundation and `/enter` route.

### Projects and Decks

Owns user projects, decks, slides, edit state, and deck status.

### Templates

Owns template metadata, compatibility rules, and presentation style selection.

Third-stage file: `src/templates.js` now provides a default multi-template catalog and theme metadata consumed by the workspace through `/api/templates`.

### Generation

Owns task creation, prompt planning, outline generation, slide JSON generation, and worker orchestration.

Second-stage files: `src/tasks.js` and `src/ai-provider.js` provide task and AI-provider abstractions.

Third-stage files: `src/ppt-service.js`, `src/prompt-manager.js`, and `src/ppt-exporter.js` implement outline, deck, retry, preview, and export orchestration.

### Billing

Owns credit balance reads, reserve, settle, release, consume, idempotency keys, and reconciliation states.

Second-stage file: `src/billing.js` wraps Moling entitlement operations.

### Files

Owns uploads, generated assets, exports, storage keys, download URLs, and retention policy.

Second-stage file: `src/files.js` implements local owner-scoped upload and download.

### Observability

Owns structured logs, metrics, traces, audit records, and alert hooks.

Second-stage files: `src/logger.js` and `src/errors.js`.

### Administration

Future module for operational task inspection, billing reconciliation, and support workflows.

## Dependency Direction

- API layer calls modules.
- Modules call infrastructure adapters through interfaces.
- Infrastructure adapters do not call domain modules.
- Billing is a required dependency for chargeable workflows.
- File management is the only module allowed to issue storage URLs.
