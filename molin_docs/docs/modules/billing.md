# Billing Module

The billing foundation wraps Moling prepaid entitlement operations.

Current implementation:

- `src/billing.js`
- reserve credits
- settle credits
- release credits
- balance lookup
- consume operation
- numeric ID coercion for Moling JSON payloads
- entitlement usability checks (`usable` / `status`) before reserve

Third-stage usage:

- `PptService.generateDeck` calls balance -> reserve -> settle/release.
- `PptService.regenerateSlide` calls balance -> reserve -> settle/release.
- billing events are recorded for reserve, settle, release, and consume.
- `PptService.reconcileBillingEvents` retries `settle_pending` and `release_pending` events, restores ready deck/task state after successful settlement, and makes failed generation retryable after a delayed release succeeds.

Future work:

- automated scheduled reconciliation worker
