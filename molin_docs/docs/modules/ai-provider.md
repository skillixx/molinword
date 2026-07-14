# AI Provider Module

The AI provider foundation defines the provider boundary without coupling the app to a specific vendor.

Current implementation:

- `src/ai-provider.js`
- `src/prompt-manager.js`
- mock outline generation
- mock slide JSON generation
- single-slide regeneration
- HTTP provider adapter selected with `LLM_PROVIDER=http`
- HTTP provider timeout controlled by `LLM_TIMEOUT_MS`, default 30000 ms
- transient HTTP 5xx or network failures retried up to `LLM_MAX_RETRIES`, default 0
- provider response validation for `outline`, `slides`, and `slide`
- prompt payload builders for outline, deck, and single-slide regeneration

Future work:

- image provider adapters
- cost and rate-limit controls

## HTTP Provider Contract

The HTTP provider supports two formats:

- Legacy contract: JSON with `operation` and `input` fields.
- OpenAI-compatible `chat/completions` contract when the URL is `/chat/completions`:
  - payload uses `messages` and optional `model`
  - response is read from `choices[0].message.content` and parsed as JSON

For both modes, the parsed payload must finally contain:

- `generate_outline`: `{ "outline": [...] }`
- `generate_slides`: `{ "slides": [...] }`
- `regenerate_slide`: `{ "slide": { ... } }`

DeepSeek / chat-completions mode uses the same operation payloads, but the adapter is tolerant to common model behaviors:

- If the model returns an array for `generate_outline`, the adapter treats it as `{ "outline": [...] }`.
- If the model returns an array for `generate_slides`, the adapter treats it as `{ "slides": [...] }`.
- If the model returns a slide object directly for `regenerate_slide`, the adapter treats it as `{ "slide": { ... } }`.
- If the model returns JSON in `reasoning_content` while `content` is empty, the adapter will parse `reasoning_content` first.

Malformed responses fail with `AI_PROVIDER_INVALID_RESPONSE` so bad provider payloads do not silently create invalid decks.

The app sends an abort signal to the HTTP provider request. Provider 5xx responses and network failures are retried within the configured retry budget; validation failures and non-5xx provider errors are not retried.
