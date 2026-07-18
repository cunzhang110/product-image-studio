import { describe, expect, it } from "vitest";
import {
  buildOpenRouterPayload,
  getOpenRouterErrorMessage,
  OPENROUTER_PROMPT_MODEL,
  requestOpenRouterWithRetry
} from "./request.js";

describe("OpenRouter proxy payload", () => {
  it("forces the approved prompt model", () => {
    const payload = buildOpenRouterPayload({
      model: "untrusted/model",
      messages: [{ role: "user", content: "hello" }]
    });

    expect(payload.model).toBe(OPENROUTER_PROMPT_MODEL);
    expect(payload.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("retries temporary upstream rate limits before returning success", async () => {
    const responses = [
      new Response("rate limited", { status: 429 }),
      new Response("still limited", { status: 429 }),
      new Response('{"choices":[]}', { status: 200 })
    ];
    const delays: number[] = [];

    const response = await requestOpenRouterWithRetry(
      async () => responses.shift()!,
      "https://openrouter.ai/api/v1/chat/completions",
      {},
      async (delay: number) => { delays.push(delay); }
    );

    expect(response.status).toBe(200);
    expect(responses).toHaveLength(0);
    expect(delays).toEqual([1500, 3500]);
  });

  it("explains exhausted Gemma free-model rate limits in Chinese", () => {
    const body = JSON.stringify({
      error: {
        message: "Provider returned error",
        metadata: { raw: "google/gemma-4-31b-it:free is temporarily rate-limited upstream." }
      }
    });

    expect(getOpenRouterErrorMessage(429, body)).toContain("Gemma 免费模型当前繁忙");
  });
});
