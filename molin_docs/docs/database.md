# Database Design

## Database Choice

Use PostgreSQL for production. The domain has relational data, billing consistency requirements, task state transitions, and audit records that benefit from transactions and constraints.

The second-stage framework uses a dependency-light JSON-file database adapter for local initialization and unit tests. It is an adapter boundary, not the production database choice.

## Core Entities

The runtime app (`ppt-ai-app/src/server.js`) initializes these collections by default:

- `sessions`
- `files`
- `tasks`（内存任务中心兼容入口，当前不持久化任务数据）
- `users`
- `billing_events`
- `outlines`
- `decks`
- `generation_tasks`
- `call_logs`

The server does not initialize `projects`、`templates`、`slides`、`audit_logs` in the current branch.

### users

Stores Moling identity references, not passwords.

Current fields are not yet persisted by the workflow (reserved for future extension):

- `id`, `created_at`, `updated_at`

### sessions

Stores application sessions created from verified Moling launch tickets. The local adapter persists these records so a process restart does not force a valid user to relaunch from Moling.

Fields:
- `id`
- `identity`（包含 `user_id`, `app_id`, `product_id` 等）
- `entitlementId`
- `createdAt`, `expiresAt`（会话语义字段）
- `created_at`, `updated_at`（JSON 适配器自动补全）

### decks

Represents one generated presentation.

Fields:
- `id`
- `ownerUserId`
- `outlineId`
- `title`
- `templateId`
- `theme`
- `status`（`billing_pending`/`ready`）
- `slides`
- `created_at`, `updated_at`

### generation_tasks

Tracks asynchronous AI jobs and billing state.

Fields:
- `id`
- `ownerUserId`
- `outlineId`
- `entitlementId`
- `status`（`running`/`succeeded`/`failed`/`reconcile_pending`/`release_pending`）
- `progress`（0-100）
- `retryable`
- `deckId`
- `errorCode`
- `errorMessage`
- `originalErrorMessage`
- `created_at`, `updated_at`

### outlines

Stores editable AI-generated outlines before full deck generation.

Fields:
- `id`
- `ownerUserId`
- `topic`
- `templateId`
- `theme`
- `status`（`outline_ready`/`outline_edited`）
- `input`（包含 `topic`、`sourceFileId`、`slideCount` 等）
- `slides`
- `created_at`, `updated_at`

### billing_events

Stores application-side billing attempts for reconciliation.

Fields:
- `id`
- `ownerUserId`
- `taskId`
- `eventType`（`reserve`/`settle`/`release`）
- `amount`
- `status`（`reserved`/`settled`/`released`/`settle_pending`/`release_pending`/`reconcile_failed`）
- `holdId`
- `idempotencyKey`
- `platformResponse`
- `errorMessage`
- `created_at`, `updated_at`

### files

Stores metadata for uploads and generated exports.

Fields:
- `id`
- `ownerUserId`
- `fileName`
- `mimeType`
- `storageKey`
- `sizeBytes`
- `status`（`available`）
- `created_at`, `updated_at`

### call_logs

Stores user-scoped application actions for audit and troubleshooting.

Fields:
- `id`
- `ownerUserId`
- `action`
- `resourceType`
- `resourceId`
- `metadata`
- `created_at`, `updated_at`

## Consistency Rules

- Credit reservation and task creation are persisted before a worker starts generation.
- Billing idempotency keys are unique.
- Users can only access rows where ownership resolves to their Moling user identity.
- Application sessions are restored from the database only while `expiresAt` is still in the future.
- Failed generation after a successful reserve must produce a release event.
- Successful generation after a reserve must produce a settle event.

## Indexes

- `sessions.id`
- `sessions.expiresAt`
- `decks.ownerUserId`
- `decks.outlineId`
- `generation_tasks.ownerUserId, status`
- `billing_events.idempotencyKey`
- `files.ownerUserId`
- `outlines.ownerUserId`
