import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import handler from "./edits.js";

const createRequest = (body: unknown) => {
  const request = new EventEmitter() as EventEmitter & { method: string };
  request.method = "POST";
  queueMicrotask(() => {
    request.emit("data", Buffer.from(JSON.stringify(body)));
    request.emit("end");
  });
  return request;
};

const createResponse = () => {
  let resolveFinished!: () => void;
  const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; },
    send() { resolveFinished(); },
    json() { resolveFinished(); }
  };
  return { response, finished };
};

describe("Muzhi edits proxy", () => {
  beforeEach(() => {
    process.env.MUZHI_API_KEY = "test-key";
  });

  it("forwards response_format so b64_json is returned instead of an opaque URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[{"b64_json":"image-data"}]}', {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { response, finished } = createResponse();

    await handler(createRequest({
      model: "gpt-image-2",
      prompt: "test",
      response_format: "b64_json",
      images: ["data:image/png;base64,aGVsbG8="]
    }) as any, response as any);
    await finished;

    const formData = fetchMock.mock.calls[0][1].body as FormData;
    expect(formData.get("response_format")).toBe("b64_json");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.muzhi.ai/v1/images/edits?response_format=b64_json");
  });
});
