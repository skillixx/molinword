# User Invocation Flow

## Entry Flow

1. User opens the AI PPT product from Moling.
2. Moling redirects to the app entry URL with a one-time launch ticket appended to `access_url`.
3. The backend verifies the ticket with Moling.
4. The backend creates an application session and loads the user's workspace.

## PPT Creation Flow

1. User chooses a template, topic, or source file.
2. User configures language, tone, slide count, and audience.
3. App validates input and checks whether the user can perform generation.
4. App creates an asynchronous generation task.
5. User sees progress and can leave the page while the task continues.
6. Generated deck appears in the user's project list when complete.

## Editing Flow

1. User opens a generated deck.
2. User edits slide text, layout, or speaker notes.
3. User can request slide-level regeneration where allowed.
4. App persists slide changes and records chargeable AI actions when applicable.

## Export Flow

1. User selects export format.
2. App validates ownership and deck status.
3. App creates an export task.
4. Worker generates export file and stores it.
5. App issues a five-minute signed download URL for the owner.
6. User downloads through the signed URL and the app records a `file_downloaded` log.

## Failure Flow

- If login fails, user returns to Moling.
- If credits are insufficient, user is prompted to buy credits.
- If generation fails after reserve, credits are released.
- If billing reconciliation is pending, generated output remains locked: preview, export, and slide regeneration are blocked until settlement succeeds.
