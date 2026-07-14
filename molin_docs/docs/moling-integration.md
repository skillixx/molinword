# Moling Platform Integration Flow

## Integration Goals

- Reuse Moling identity and access control.
- Reuse Moling prepaid credit products and entitlement ledger.
- Keep internal platform credentials server-side.
- Provide auditable billing behavior for every chargeable AI action.

## Application Launch

1. Moling product entry redirects to the application access URL.
2. Redirect includes a one-time launch ticket by appending `?ticket=...` to `access_url`.
3. Application backend verifies the ticket with Moling internal API.
4. Backend validates app and product association.
5. Backend creates its own application session, persists it in the `sessions` collection, and sets an HTTP-only cookie.

The app accepts launch tickets on `/?ticket=...`, `/enter?ticket=...`, and `/auth/launch?ticket=...`. Configure Moling `access_url` as the public app root unless a path-specific entry is required.

Valid persisted sessions survive application process restarts. The backend restores the session from storage when the cookie is present and the stored `expiresAt` value is still in the future.

The current implementation reads `MOLING_APP_ID` and `MOLING_PRODUCT_ID` from environment variables and rejects launch tickets whose `app_id` or `product_id` do not match. Deployment commands may also use the compatibility aliases `PPT_APP_ID`, `PPT_PRODUCT_ID`, and `PORT`.

## Product and Entitlement Setup

Platform configuration must provide:

- application record
- application product
- credit packages or plans
- role access rules for view, buy, and use
- internal API token through a secure channel
- allowed application server IPs

## Entitlement Discovery

The application identifies the current user's active PPT credit entitlement at launch time. Supported Moling launch verification fields:

- `entitlement_id`
- `default_entitlement_id`
- `entitlement.entitlement_id`
- `entitlement.id`
- `entitlements[].entitlement_id`
- `entitlements[].id`
- `entitlementId`（兼容）
- `defaultEntitlementId`（兼容）
- `entitlement.entitlementId`（兼容）
- `entitlements[].entitlementId`（兼容）
- `entitlements[].productId`（兼容）

When `entitlements[]` is returned, the app prefers an active, usable entitlement whose `product_id` matches the verified product. Chargeable APIs resolve entitlement IDs in this order:

1. request `entitlement_id`
2. launch identity entitlement
3. Moling internal `GET /api/internal/user-entitlements?user_id={user_id}&product_id={product_id}`
4. temporary `MOLING_USER_ENTITLEMENT_MAP` entry for the current `user_id`
5. `MOLING_DEFAULT_ENTITLEMENT_ID` or compatibility alias `PPT_DEFAULT_ENTITLEMENT_ID`

The workspace page pre-fills the resolved session entitlement. This avoids using one fixed entitlement ID for every user while still allowing a per-user manual fallback for environments where Moling has not yet deployed entitlement discovery. A single `MOLING_DEFAULT_ENTITLEMENT_ID` is only appropriate for controlled single-user smoke tests.

## Internal API Boundary

- Backend calls Moling internal APIs with `INTERNAL_API_TOKEN`.
- Frontend never calls Moling internal APIs.
- Internal token is never logged, stored in the database, or sent to users.

## Acceptance for Integration

- invalid tickets cannot create sessions
- valid sessions survive application process restarts until expiry
- app/product mismatch is rejected
- launch identity entitlement is preferred over configured fallback
- insufficient credits are surfaced without AI provider calls
- reserve, settle, and release are idempotent
- platform errors map to stable application errors
