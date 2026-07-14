# Permission Design

## Identity Source

Moling is the source of user identity. The application stores only the Moling user ID and local profile metadata needed for the product.

## Roles

Initial application roles:

- user: owns projects, decks, files, and generation tasks
- operator: can inspect tasks and reconciliation status
- admin: can manage operational settings in future phases

Moling product access controls decide whether a user can enter, buy, or use the application.

## Authorization Rules

- Every request requires a valid application session except health checks and Moling entry route.
- Users can read and mutate only their own projects, decks, slides, files, and tasks.
- HTTP file download and log routes remain owner-scoped; one user's files and `file_downloaded` audit entries are not visible to another user.
- Operators can view operational metadata but not raw secrets.
- Admin actions require explicit audit logging.

## Platform Permissions

The application validates Moling launch identity and product association before creating a session. Billing APIs are called with backend credentials only.

## Sensitive Data

Never expose:

- `INTERNAL_API_TOKEN`
- AI provider API keys
- storage write credentials
- test account password
- raw launch tickets after exchange
