# Project Overview

## Goal

Build a production-ready AI PPT tool as a Moling platform application. Users enter from Moling, generate high-quality presentations with AI, manage generated files, and consume Moling prepaid credits through the platform billing system.

## Product Scope

The product experience references Presenton for interaction patterns such as topic input, outline confirmation, slide generation, editing, and export. Presenton source code is not used as the implementation base.

Current delivery status (third-stage scope):

- create a PPT from a topic, prompt, document, or selected template
- review and edit outline before generation
- generate slide content and slide layouts
- preview generated PPT in the browser
- export PPTX and PDF files
- view credit balance and generation history
- perform failed-task retry and billing reconciliation checks

## Delivered Business Scope

Deliverables:

- local API and in-process business implementation
- Moling launch/session integration and entitlement enforcement
- outline generation, editable draft flow, deck generation, slide regeneration, preview, and export
- billing reserve/settle/release, retry paths, and call logs
- file upload/download path with signed URL fallback
- production-oriented Docker container image and compose entry
- local acceptance + API contract tests

## Delivery Notes

- The data layer currently uses a JSON file adapter for local and deterministic environments.
- Production hardening target items include PostgreSQL migration and separate worker topology; these are tracked in `docs/development-plan.md` and related module notes.
- API surface, workspace flow, and billing behaviors are covered by local tests and documented in `docs/api.md` and `docs/acceptance.md`.
