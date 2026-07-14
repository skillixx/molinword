# Third-Stage Business Design

## End-to-End Flow

The implemented acceptance flow is:

1. Moling login creates a persisted application session.
2. User submits a topic or uploaded document.
3. AI Provider creates an editable outline.
4. User edits the outline.
5. Backend checks balance and reserves credits.
6. AI Provider generates structured slides.
7. Backend settles credits on success or releases on failure.
8. User previews the deck online.
9. User exports PPTX and PDF.
10. Backend records billing events and call logs.

## Prompt and Provider Model

`PromptManager` builds structured prompt payloads for outline generation, deck generation, and single-slide regeneration. `PptService` never sends ad hoc slide regeneration payloads directly to the provider; every AI action goes through the prompt boundary first.

The HTTP AI provider validates response shape before returning data to the workflow. Missing `outline`, `slides`, or `slide` fields raise `AI_PROVIDER_INVALID_RESPONSE`. Provider calls are bounded by `LLM_TIMEOUT_MS`; transient 5xx or network failures can retry up to `LLM_MAX_RETRIES`, while malformed provider payloads fail fast.

## Retry Model

Failed deck generation after reserve is marked retryable. The retry operation reuses the original outline and starts a new reserve -> settle/release cycle with a new task ID.

The workspace currently performs lightweight task polling after `/api/ppt/decks` and `/api/ppt/tasks/{task_id}/retry` responses. Users can therefore see `running`/`succeeded` progress updates and can act on `retryable` state when generation fails.

Single-slide regeneration also uses reserve -> settle/release. If the AI provider fails while regenerating a slide, the hold is released and no credits are consumed for the failed edit.

## Session Model

Moling launch verification creates an HTTP-only application session cookie and a matching record in the local `sessions` collection. Each session stores the verified Moling identity, resolved entitlement ID, creation time, and expiry time. Runtime memory caches sessions for speed, but authorization can restore a valid session from the database after a process restart.

## Document-Driven Outline and Multi-User Isolation

When `source_file_id` is provided, outline generation reads file content in the caller's ownership context and passes that document text into prompt construction. The resulting outline is still persisted under the current session user, so later deck generation uses the same identity/entitlement pair as `session.entitlementId` and cannot cross user boundaries.

## Export Model

`PptExportService` is intentionally behind an interface. The current implementation accepts only `pptx` and `pdf`, generates a minimal Office Open XML PPTX ZIP package and a minimal PDF with xref/trailer without external dependencies, and rejects unknown formats with `EXPORT_FORMAT_UNSUPPORTED`. A later renderer can produce richer theme-accurate PPTX/PDF output without changing API or service boundaries.

## Local Acceptance

Use `LOCAL_MOLING_MOCK=true` to run the full HTTP acceptance flow without external Moling credentials. Start the app, then run `npm run acceptance`. This verifies login, outline generation, outline edit, deck generation, preview, PPTX/PDF export, real file download, billing calls, and call logs through the same HTTP APIs used by the UI.
