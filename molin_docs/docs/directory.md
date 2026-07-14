# Project Directory Design

## Top-Level Structure

```text
.
├── docs/
│   ├── project-overview.md
│   ├── requirements.md
│   ├── architecture.md
│   ├── technology.md
│   ├── directory.md
│   ├── database.md
│   ├── api.md
│   ├── workflow.md
│   ├── billing.md
│   ├── deployment.md
│   ├── user-flow.md
│   ├── moling-integration.md
│   ├── development-plan.md
│   ├── modules.md
│   ├── file-management.md
│   ├── permissions.md
│   ├── logging.md
│   ├── error-handling.md
│   ├── testing.md
│   └── acceptance.md
├── ppt-ai-app/
│   ├── package.json
│   └── README.md
├── app/
│   └── Moling platform and product integration references
├── presenton/
│   └── vendored reference project
├── .env.example
└── README.md
```

## Future Application Structure

When implementation begins, `ppt-ai-app/` should use explicit module boundaries:

```text
ppt-ai-app/
├── src/
│   ├── app/
│   ├── config/
│   ├── modules/
│   │   ├── auth/
│   │   ├── billing/
│   │   ├── decks/
│   │   ├── files/
│   │   ├── generation/
│   │   ├── templates/
│   │   └── observability/
│   ├── infrastructure/
│   │   ├── moling/
│   │   ├── ai/
│   │   ├── storage/
│   │   ├── database/
│   │   └── queue/
│   └── workers/
├── test/
└── migrations/
```

## Rules

- Business modules depend on interfaces, not concrete providers.
- Provider adapters live under `infrastructure/`.
- Database schema changes live under `migrations/` only after implementation is approved.
- The vendored `presenton/` directory is reference material and must not become the application runtime.
