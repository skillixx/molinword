# Testing Strategy

## Test Levels

- unit tests for pure domain services
- adapter tests for Moling, storage, database, queue, and AI provider boundaries
- integration tests for generation task lifecycle
- billing tests for reserve, settle, release, consume, and idempotency
- end-to-end tests for Moling entry, generation, preview, export, and insufficient credit flows

## Required Scenarios

- valid Moling launch creates an application session
- launch ticket works from `/?ticket=...`, `/enter?ticket=...`, and `/auth/launch?ticket=...`
- invalid or expired launch ticket is rejected
- user cannot access another user's deck, file, or task
- session entitlement is resolved from launch identity, Moling user entitlement lookup, temporary user map, or explicit default in that order
- generation reserves credits before AI work
- successful generation settles credits
- failed generation releases credits
- settle failure creates reconciliation state
- insufficient credits prevent AI provider calls
- unusable entitlements are blocked before AI provider calls
- export creates a downloadable file for the owner only
- exported PPTX/PDF files can be downloaded and create `file_downloaded` logs
- single-slide regeneration accepts either `slide_id` or one-based page number and preserves stable slide identity

## Verification Commands

```bash
cd ppt-ai-app
npm test
npm run acceptance
```

For deployments that temporarily configure `MOLING_USER_ENTITLEMENT_MAP`, also run:

```bash
npm run validate:moling-config
```

Real Moling acceptance requires a fresh one-time ticket from the platform entry flow:

```bash
ACCEPTANCE_BASE_URL=http://127.0.0.1:5177 \
ACCEPTANCE_LAUNCH_TICKET=<real_launch_ticket> \
ACCEPTANCE_ENTITLEMENT_ID=<optional_entitlement_id> \
npm run acceptance:moling
```

## Non-Functional Tests

- concurrent generation requests do not double-charge
- queue retry does not duplicate billing
- large uploads are rejected by configured limits
- logs redact tokens and passwords
- worker restart resumes or reconciles incomplete tasks

## First-Stage Verification

During the architecture-only phase, verification is limited to:

- required documents exist
- no business source code is present in the application workspace
- `.env.example` contains placeholders only
- README states the current phase constraints
