# OpenRouter Prompt Generation Design

## Goal

Use OpenRouter's `google/gemma-4-31b-it:free` model exclusively for prompt generation while keeping Yunwu, APIMart, and Muzhi unchanged as image-generation providers. Improve legibility across the workspace without changing its core workflow.

## Architecture

- The browser calls a same-origin Vercel API route for prompt generation.
- The Vercel route reads `OPENROUTER_API_KEY` from the server environment and forwards requests to OpenRouter.
- The route forces the model to `google/gemma-4-31b-it:free`; the browser cannot select or override it.
- Product reference images are sent as OpenAI-compatible multimodal `image_url` content alongside the prompt template and creative guidance.
- Existing Yunwu and APIMart browser keys remain dedicated to image generation. Muzhi continues to use its existing server proxy.

## Compatibility

New batches store OpenRouter/Gemma as the prompt provider and model. Persisted batches created by older versions are normalized during loading so users can continue working without deleting local data.

## Interface

- Replace the prompt-provider selector with a fixed OpenRouter/Gemma status display.
- Explain in provider settings that prompt generation is configured on the server.
- Raise small labels, metadata, text inputs, and buttons to readable sizes, with primary controls generally 40-46 px tall.
- Slightly widen side panels where necessary to avoid wrapping and preserve the current compact production-tool layout.

## Security

The OpenRouter key is stored only in Vercel's encrypted production environment. It is never returned to the browser, committed to Git, or persisted in local storage.

## Verification

Unit tests cover the fixed model, multimodal request shape, domain defaults, and persisted-batch migration. Type checking, production build, and desktop/mobile browser screenshots verify the complete flow and visual changes.
