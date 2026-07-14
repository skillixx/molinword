# API Design

## API Principles

- All APIs are served by the application backend.
- Browser clients never call Moling internal APIs directly.
- All write APIs require a valid application session created from Moling launch.
- Long-running generation APIs return task IDs and are completed asynchronously.
- Billing errors are mapped to product-level messages without exposing internal secrets.
- Malformed JSON request bodies return `REQUEST_JSON_INVALID` with HTTP 400.
- JSON request bodies over 1 MiB return `REQUEST_BODY_TOO_LARGE` with HTTP 413.

## Public Application Routes

The application implements foundation routes plus third-stage AI PPT business routes.

### `GET /api/health`

Returns `{ "status": "ok" }` for runtime health checks.

### `GET /?ticket=...`, `GET /enter?ticket=...`, `GET /auth/launch?ticket=...`

Entry points from Moling platform. Moling normally appends the one-time `ticket` to the configured `access_url`; the root path form supports an `access_url` such as `https://ppt.example.com`. The `/enter` and `/auth/launch` forms are compatibility aliases. All forms verify the ticket with Moling, create an application session, and redirect to the workspace.

### `GET /api/me`

Returns current application user profile and platform identity summary.

### `GET /api/templates`

Returns template metadata from the template manager.

### `GET /api/billing/balance`

Returns the current session entitlement ID and Moling balance. It accepts optional `entitlement_id` for operator/debug checks; otherwise it uses the entitlement resolved from Moling launch identity and then the configured default fallback. The resolved value must be a positive integer; invalid values return `ENTITLEMENT_INVALID`, and requests without any resolvable entitlement return `ENTITLEMENT_REQUIRED`.

Response fields: `entitlement_id`, `balance`.

### `POST /api/tasks`

Creates a generic in-memory application task record.

### `GET /api/tasks/{task_id}`

Reads generic task metadata (`status`, `progress`, `result`) and is used as a compatibility facade in tests.

### `POST /api/ppt/outlines`

Generates an editable AI outline from `topic` or `source_file_id`. Supports `slide_count`, `template_id`, and `theme`. `slide_count` must be an integer from 1 to 20, and `theme` must be one of the selected template's `themes`.
If the AI provider is unavailable or returns malformed responses, this API returns `AI_PROVIDER_FAILED` (HTTP 502).

### `GET /api/files/{file_id}/download-url`

Returns a short-lived authorized download URL for an owner-scoped file. The request requires the current user's application session. The response contains `url` and `expires_at`.

The returned URL is signed by the backend, expires after five minutes, and can be fetched without a session cookie. The signed URL response and the file download response both return `Cache-Control: no-store`. Signed downloads still validate the file ID embedded in the token, enforce token expiry, return `Content-Disposition`, and record a `file_downloaded` call log.

The current local foundation also supports direct owner-checked `GET /api/files/{file_id}` downloads for compatibility.

Direct downloads return the file MIME type, `Content-Disposition` with a sanitized filename, `Cache-Control: no-store`, and record a `file_downloaded` call log for auditability.

### `POST /api/files`

Uploads an owner-scoped file.

Request fields: `file_name`, `mime_type`, `content_base64`.

The API accepts canonical base64 only. Empty content is rejected with `FILE_EMPTY`, invalid base64 with `FILE_CONTENT_INVALID`, unsupported MIME types with `UNSUPPORTED_FILE_TYPE`, and files over 2 MiB with `FILE_TOO_LARGE`.

Supported MIME types are `text/plain`, `text/markdown`, `application/json`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, and `application/vnd.openxmlformats-officedocument.presentationml.presentation`.

### `PATCH /api/ppt/outlines/{outline_id}`

Updates outline slide titles and bullets before deck generation. `slides` must be a non-empty array with no more than 20 items; each slide must include a non-empty string `title` and a `bullets` array containing only strings. Invalid edits return `OUTLINE_INVALID` and leave the stored outline unchanged.

### `POST /api/ppt/decks`

Generates a full deck from an outline. The backend checks balance, reserves credits, calls the AI provider, settles credits on success, and releases credits on failure. Optional `entitlement_id` must be a positive integer and is rejected before any billing call if invalid.

When AI generation fails after a task is created, the public error `details` includes `task_id` and `retryable` so the workspace can call the retry API without exposing internal provider or Moling details.

If AI generation succeeds but billing settlement is pending, the deck is stored with `billing_pending` status and user-facing deck operations return `DECK_BILLING_PENDING` until reconciliation marks it `ready`.

### `GET /api/ppt/decks/{deck_id}/preview`

Returns an owner-checked HTML preview of generated slides. Decks in `billing_pending` state are blocked.

### `POST /api/ppt/decks/{deck_id}/exports`

Exports a generated deck to `pptx` or `pdf` and stores the generated file. Decks in `billing_pending` state are blocked.

Request field `format` must be `pptx` or `pdf`; other values return `EXPORT_FORMAT_UNSUPPORTED`.

### `POST /api/ppt/decks/{deck_id}/slides/{slide_id}/regenerate`

Regenerates one slide using an instruction and consumes known-cost credits. Decks in `billing_pending` state are blocked.

If slide regeneration fails and Moling release also fails, the API returns `BILLING_RECONCILIATION_PENDING` and records a `release_pending` billing event for reconciliation.

If slide regeneration succeeds but Moling settle fails, the deck is locked as `billing_pending` with a `settle_pending` event until reconciliation succeeds.

### `POST /api/ppt/tasks/{task_id}/retry`

Retries a failed generation task using the stored outline and a new billing operation.

### `GET /api/ppt/tasks/{task_id}`

Returns the persisted PPT generation task record, including `status`, `progress`, `retryable`, `deckId`, and error fields when present. This route is owner-scoped and remains available after the in-memory task center is reset because it reads from `generation_tasks`.

### `GET /api/logs`

Returns owner-scoped call logs for generation, export, retry, and billing-adjacent actions.

### `POST /internal/reconcile`

Retries pending billing settlement and release events. This is an operational endpoint and requires the backend `X-Internal-Token` header to match `INTERNAL_API_TOKEN`.

Request fields: optional `limit`.

Response fields: `result.checked`, `result.settled`, `result.released`, `result.failed`.

## Internal Worker Interfaces

Worker messages are not public HTTP APIs. Queue payloads must include `task_id`, `task_type`, `owner_user_id`, and `idempotency_key`. Workers load full state from the database before executing to avoid trusting queue payloads as the source of truth.

## Error Shape

Every HTTP response includes an `X-Request-Id` header. Error responses also repeat the same identifier as `error.request_id` so browser reports, backend logs, file downloads, and internal reconciliation calls can be correlated.

```json
{
  "error": {
    "code": "INSUFFICIENT_CREDITS",
    "message": "积分不足，请购买积分包后重试。",
    "request_id": "req_xxx",
    "details": {
      "task_id": "optional_retryable_task_id",
      "retryable": true
    }
  }
}
```

`details` is only serialized for explicitly public fields such as retryable task references. Internal platform response data remains server-side.

## Versioning

Use `/api/` for the first internal product release. Introduce `/api/v2/` only when response contracts become incompatible.
