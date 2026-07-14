# Moling Platform Module

The Moling platform foundation centralizes internal platform API calls.

Current implementation:

- `src/moling-client.js`
- internal POST and GET helpers
- launch ticket verification
- Moling envelope parsing
- `X-Internal-Token` injection from environment configuration

Future work:

- entitlement discovery
- retry policy
- platform error mapping table
- request metrics
