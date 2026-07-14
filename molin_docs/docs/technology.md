# Technology Selection

## Application Runtime

Use Node.js with ESM for the application workspace. Node aligns with the current lightweight project setup and supports API, worker, and build tooling in one ecosystem.

## Backend Pattern

Use a modular monolith with explicit module boundaries. This avoids premature microservices while keeping billing, generation, file, and platform adapters separable.

## Database

Use PostgreSQL in production for relational consistency, transactional billing state, and auditability.

## Queue

Use Redis-backed queue infrastructure or an equivalent managed queue. Generation and export jobs must be asynchronous and retryable.

## Object Storage

Use S3-compatible object storage for uploads, generated assets, PPTX/PDF exports, and thumbnails.

## AI Providers

Use provider adapters so LLM and image generation providers can be swapped without changing workflow code. Provider credentials must come from environment variables.

## Observability

Use structured JSON logs, metrics, and distributed tracing. Billing reconciliation failures require explicit alerts.

## Deployment

Use containerized API and worker services. Deploy API and workers independently so generation capacity can scale without scaling the web tier.
