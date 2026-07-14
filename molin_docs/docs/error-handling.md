# Error Handling Design

## Error Categories

- authentication errors
- authorization errors
- validation errors
- insufficient credits
- platform integration errors
- AI provider errors
- file storage errors
- export errors
- unexpected system errors

## User-Facing Rules

- Explain recoverable failures clearly.
- Do not expose internal stack traces or provider responses.
- Show insufficient credits as a product action: buy credits or retry after purchase.
- Show generation failure with refund or release status when credits were reserved.
- Return `REQUEST_JSON_INVALID` with HTTP 400 for malformed JSON request bodies.
- Return `REQUEST_BODY_TOO_LARGE` with HTTP 413 for JSON request bodies over 1 MiB.

## Internal Error Shape

Application errors should carry:

- stable code
- HTTP status
- user-safe message
- internal diagnostic message
- retryability
- request ID

## Retry Rules

- Retry transient provider, storage, and platform 5xx failures with bounded attempts.
- Never change billing idempotency keys during retries.
- Do not retry validation, authorization, or insufficient credit errors.
- Reconciliation handles failed settle and release operations through `POST /internal/reconcile`; generated decks remain `billing_pending` until settlement succeeds, and failed generations remain non-retryable until release succeeds.

## Fail-Closed Behavior

If platform identity, billing configuration, or entitlement status cannot be verified, the application must block chargeable work.
