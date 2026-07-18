import { describe, expect, it } from "vitest";
import { buildOpenRouterPayload, OPENROUTER_PROMPT_MODEL } from "./request.js";

describe("OpenRouter proxy payload", () => {
  it("forces the approved prompt model", () => {
    const payload = buildOpenRouterPayload({
      model: "untrusted/model",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(payload.model).toBe(OPENROUTER_PROMPT_MODEL);
    expect(payload.messages).toEqual([{ role: "user", content: "hello" }]);
  });
});
