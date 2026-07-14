# Template Module

The template foundation stores and retrieves template metadata.

Current implementation:

- `src/templates.js`
- list templates
- get one template by ID
- default catalog with `business`, `education`, and `pitch`
- each template exposes multiple theme values
- workspace loads `/api/templates` and updates the theme selector when the template changes
- backend rejects theme values that are not declared by the selected template

Future work can add persisted template catalogs, preview assets, and richer compatibility rules by deck type and slide count without changing the current API contract.
