# PPT Service Module

The PPT service orchestrates the complete AI PPT workflow.

Current implementation:

- `src/ppt-service.js`
- topic-to-outline generation
- uploaded-document-to-outline generation
- outline editing
- deck generation with template, theme, and page count
- balance check, reserve, settle, release, and consume billing calls
- failed generation retry
- single-slide regeneration
- online preview
- PPTX and PDF export storage
- owner-scoped call logs

Design notes:

- Outline generation is separated from deck generation so users can edit before chargeable work.
- Edited outlines are validated before persistence so malformed slide JSON or edits over the 20-page limit cannot reach chargeable deck generation.
- Full deck generation uses reserve -> settle/release because it is expensive and failure-prone.
- Single-slide regeneration uses reserve -> settle/release so failed AI edits release the hold and do not consume credits; release failures are recorded as `release_pending`, and settle failures lock the deck as `billing_pending` until reconciliation restores it to `ready`.
- The current exporter accepts only `pptx` and `pdf`, produces a minimal Office Open XML PPTX ZIP package and a minimal PDF with xref/trailer without external dependencies, and rejects unknown formats with `EXPORT_FORMAT_UNSUPPORTED`. A richer production renderer can replace `PptExportService` behind the same interface.
