# Files Module

The files foundation supports owner-scoped local uploads and downloads.

Current implementation:

- `src/files.js`
- local storage directory from environment configuration
- file metadata persisted through the database adapter
- owner checks before download
- owner-scoped `GET /api/files/{file_id}/download-url` issues five-minute signed download URLs
- signed URL responses and downloads return `Cache-Control: no-store`
- signed and direct downloads return `Content-Disposition` and record `file_downloaded` call logs
- upload validation rejects empty files, files over 2 MiB, unsupported MIME types, and invalid API payloads

Allowed MIME types:

- `text/plain`
- `text/markdown`
- `application/json`
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.openxmlformats-officedocument.presentationml.presentation`

Future work:

- object storage adapter
- pre-signed upload URLs
- antivirus or content scanning
- retention cleanup
