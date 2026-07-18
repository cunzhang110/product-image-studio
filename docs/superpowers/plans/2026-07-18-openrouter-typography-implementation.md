# OpenRouter Prompt and Typography Implementation Plan

1. Add failing tests for fixed OpenRouter defaults, persisted-batch normalization, and multimodal prompt requests.
2. Add a Vercel server proxy that forces `google/gemma-4-31b-it:free` and reads `OPENROUTER_API_KEY` server-side.
3. Update the prompt service and workflow state to use the fixed OpenRouter route while preserving all image providers.
4. Replace prompt-provider controls with a fixed status display and update provider settings copy.
5. Increase workspace typography and button sizing, then adjust panel widths for stable desktop and mobile layouts.
6. Update browser verification mocks and run tests, type checking, build, and visual verification.
7. Configure the production Vercel environment, merge and push `main`, deploy, and inspect the live site.
