# File Management Design

## File Categories

- user uploads: documents, outlines, source PPT files
- generated assets: images, charts, thumbnails
- generated exports: PPTX and PDF
- temporary worker artifacts

## Storage

Use object storage for binary files and PostgreSQL for metadata.

Metadata includes:

- owner user ID
- deck ID
- storage key
- file type
- MIME type
- size
- checksum
- visibility
- lifecycle status

## Access Model

- Users can access only files they own.
- Download URLs are short-lived, signed by the backend, and expire after five minutes.
- Signed URL responses and file downloads return `Cache-Control: no-store`.
- Local direct downloads return `Content-Disposition` with a sanitized filename and write a `file_downloaded` call log.
- Signed downloads can be fetched without a session cookie but validate the signed file ID, owner ID, and expiry before reading storage.
- Direct file downloads are owner-checked at the HTTP route; cross-user downloads return `FORBIDDEN` and do not expose another user's file logs.
- Uploads use constrained pre-signed URLs when direct upload is introduced.
- Internal worker files are not user-downloadable unless promoted to generated assets or exports.

## Lifecycle

- Uploaded source files are retained while linked to an active project.
- Temporary artifacts expire automatically.
- Generated exports can be regenerated from deck data.
- Deleting a deck marks related files for asynchronous cleanup.

## Security

- Validate MIME type and size before accepting uploads.
- The local app accepts non-empty files up to 2 MiB.
- Supported MIME types are `text/plain`, `text/markdown`, `application/json`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, and `application/vnd.openxmlformats-officedocument.presentationml.presentation`.
- Scan or reject unsupported file types.
- Never expose raw storage credentials to the browser.
- Use unpredictable storage keys and avoid user-controlled paths.
