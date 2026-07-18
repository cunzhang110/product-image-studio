export const OPENROUTER_PROMPT_MODEL = "google/gemma-4-31b-it:free";

export const buildOpenRouterPayload = (body = {}) => ({
  ...body,
  model: OPENROUTER_PROMPT_MODEL,
  messages: Array.isArray(body.messages) ? body.messages : []
});
