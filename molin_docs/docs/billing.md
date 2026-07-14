# Billing Design

## Billing Model

Use Moling prepaid credits. Users purchase credit packages on Moling. The application consumes those credits through Moling entitlement APIs.

## Chargeable Actions

Initial production candidates:

- full PPT generation: reserve, then settle or release
- slide regeneration: reserve, then settle or release
- AI image generation: consume per image
- export: initially free, can become chargeable later

Exact prices are product configuration, not hardcoded application constants.

## Reserve and Settle Flow

Expensive or failure-prone actions use reserve first:

1. Create application task with a stable idempotency key.
2. Reserve credits through Moling entitlement API.
3. Enqueue the task only after reserve succeeds.
4. Settle the hold when generation succeeds.
5. Release the hold when generation fails.

## Entitlement Selection

Billing uses the current session entitlement resolved during Moling launch verification. The app prefers request `entitlement_id` for explicit operator/debug flows, then the active entitlement returned by Moling for the logged-in user, then Moling internal `user-entitlements` lookup, then `MOLING_USER_ENTITLEMENT_MAP`, and finally `MOLING_DEFAULT_ENTITLEMENT_ID` or `PPT_DEFAULT_ENTITLEMENT_ID` as a last-resort environment fallback.

Do not rely on one global entitlement ID for all production users. If Moling returns per-user entitlements, those IDs must be used so balance checks, package ownership checks, and deductions happen against the user's own credit package. `MOLING_USER_ENTITLEMENT_MAP` is a temporary bridge for known users while the Moling internal lookup endpoint is unavailable.

The API validates the final `entitlement_id` as a positive integer before balance lookup, reserve, settle, or release. Invalid package IDs fail closed with `ENTITLEMENT_INVALID` or `ENTITLEMENT_REQUIRED` and do not create billing events.

Before reserve, the app also verifies entitlement usability from the balance response. If the entitlement is not usable (`usable === false`, `usable === 0/\"0\"`, or `status !== active`), generation is blocked with `ENTITLEMENT_NOT_USABLE` and no reserve is attempted.

## Idempotency

Every billing operation has a deterministic idempotency key based on task ID and operation type.

Examples:

- `{task_id}:ppt_generate:reserve`
- `{task_id}:ppt_generate:settle`
- `{task_id}:ppt_generate:release`
- `{deck_id}:{slide_id}:ppt_slide_regenerate:reserve`
- `{deck_id}:{slide_id}:ppt_slide_regenerate:settle`
- `{deck_id}:{slide_id}:ppt_slide_regenerate:release`

## Reconciliation

The application records billing events locally so operations can be retried safely.

States: `reserve_pending`, `reserved`, `settle_pending`, `settled`, `release_pending`, `released`, `reconcile_failed`.

When AI generation succeeds but Moling `settle` fails, the deck is stored as `billing_pending`, the generation task is marked `reconcile_pending`, and the application records a `settle_pending` billing event with the original hold ID and idempotency key. Single-slide regeneration uses the same settlement rule: the regenerated slide is stored behind `billing_pending`, the deck is locked, and reconciliation retries settlement. The app does not release the hold in this case because the AI work has completed and the correct recovery action is to retry settlement.

Decks in `billing_pending` are locked from user-facing preview, export, and slide regeneration. This prevents downloading or further modifying generated output before the prepaid hold has been settled.

Operations can call `POST /internal/reconcile` with `X-Internal-Token` to retry `settle_pending` events. Successful reconciliation marks the billing event `settled`, the deck `ready`, and the generation task `succeeded`. Failed retries are marked `reconcile_failed` for operator follow-up.

When AI generation fails and Moling `release` also fails, the task is marked `release_pending`, `retryable` stays false, and a `release_pending` billing event preserves the same hold ID and idempotency key. Slide regeneration follows the same fail-closed release path: the deck remains unchanged, a `release_pending` event is recorded against the deck ID, and reconciliation retries release. Once release succeeds, the billing event becomes `released`; for full generation the task becomes retryable again.

## Platform Boundary

- `INTERNAL_API_TOKEN` is read from environment variables only.
- Moling internal APIs are called only from the backend.
- Frontend receives balance and task status through application APIs.
- Logs must not include internal tokens, user passwords, or raw provider credentials.

## Second-Stage Wrapper

The current framework provides `src/billing.js` as the central billing adapter. It wraps:

- balance lookup
- reserve credits
- settle credits
- release credits
- consume credits

All Moling IDs are coerced to JSON numbers at the adapter boundary, while credit amounts remain decimal strings.

## User Experience

- The workspace calls `GET /api/billing/balance` after login and after deck generation so users can see the active entitlement and remaining credits.
- If credits are insufficient, generation is blocked before AI work starts.
- Failed PPT generation or slide regeneration after reserve shows a refund or release status.
- Pending reconciliation is visible as a task state and monitored by operations.
