# Development Plan

## Phase 0: Architecture and Initialization

- Maintain required design documents.
- Keep application workspace free of business logic.
- Define environment variables and security rules.
- Confirm first-stage acceptance criteria.

## Phase 1: Platform Entry and Persistence

- Implement configuration loading.
- Implement Moling launch verification.
- Add session persistence.
- Add database migrations and repository boundaries.

## Phase 2: Billing Foundation

- Implement entitlement discovery.
- Implement balance lookup.
- Implement reserve, settle, release, consume, and reconciliation records.
- Add idempotency tests.

## Phase 3: AI Generation Workflow

- Add generation task API.
- Add queue and worker.
- Add outline and slide JSON generation through provider adapters.
- Add failure release and success settle paths.

## Phase 4: PPT Workspace

- Add project and deck UI.
- Add template selection.
- Add preview and slide editing.
- Add task progress states.

## Phase 5: Export and File Management

- Add upload support.
- Add generated asset storage.
- Add PPTX/PDF export.
- Add authorized download URLs and retention cleanup.

## Phase 6: Production Hardening

- Add metrics, traces, and alerts.
- Add rate limits and provider cost controls.
- Add security review and cross-user access tests.
- Complete platform acceptance and rollout checklist.
