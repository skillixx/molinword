# Requirements Analysis

## Users

- Moling platform users who need to create business presentations quickly.
- Operators who need to inspect task, billing, and reconciliation status.
- Administrators who configure product access, credit packages, and operational settings.

## User Problems

- Creating polished PPTs from scratch is slow.
- Users need outline, copy, layout, and export in one flow.
- Platform products need unified identity, permission, and billing behavior.
- Failed AI generation must not consume user credits incorrectly.

## Functional Requirements

- Enter the app from Moling without separate registration.
- Generate PPT from topic, source document, or template.
- Limit requested slide counts to 1-20 and reject unsupported template themes.
- Confirm or edit outline before expensive generation when the UX requires it.
- Track asynchronous generation progress.
- Preview, edit, regenerate, and export decks.
- Display credit balance and insufficient-credit states.
- Store generated files and allow authorized downloads.

## Non-Functional Requirements

- Billing operations are idempotent and auditable.
- Long-running AI and export work runs asynchronously.
- User data is isolated by Moling user identity.
- Secrets are injected by environment variables only.
- Logs and metrics support diagnosis without exposing sensitive data.

## First-Stage Requirements

- Create project initialization files.
- Create required design documents.
- Avoid business logic and runtime implementation.
- Use placeholders only for environment examples.
