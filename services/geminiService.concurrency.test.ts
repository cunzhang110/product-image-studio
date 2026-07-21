import { afterEach, describe, expect, it, vi } from "vitest";

const requestInit: RequestInit = { method: "POST" };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const okImageResponse = (id: string) => new Response(JSON.stringify({ id }), { status: 200 });

const loadRequestProviderJson = async () => {
  vi.resetModules();
  return (await import("./geminiService")).requestProviderJson;
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("provider request gate", () => {
  it("allows Muzhi requests to overlap", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const requestProviderJson = await loadRequestProviderJson();

    const a = requestProviderJson<{ id: string }>("muzhi", "/v1/images/generations", requestInit);
    const b = requestProviderJson<{ id: string }>("muzhi", "/v1/images/generations", requestInit);

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    first.resolve(okImageResponse("a"));
    second.resolve(okImageResponse("b"));
    await expect(Promise.all([a, b])).resolves.toEqual([{ id: "a" }, { id: "b" }]);
  });

  it.each([
    ["apimart", "VITE_APIMART_API_KEY", 5000],
    ["yunwu", "VITE_YUNWU_API_KEY", 15000]
  ] as const)("keeps %s requests serialized", async (provider, apiKeyEnv, minIntervalMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.stubEnv(apiKeyEnv, "test-key");
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const requestProviderJson = await loadRequestProviderJson();

    const a = requestProviderJson<{ id: string }>(provider, "/v1/images/generations", requestInit);
    const b = requestProviderJson<{ id: string }>(provider, "/v1/images/generations", requestInit);

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(okImageResponse("a"));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(minIntervalMs - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    second.resolve(okImageResponse("b"));
    await expect(Promise.all([a, b])).resolves.toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("retries a Muzhi 429 after its five-second minimum delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "slow down" } }), {
        status: 429,
        headers: { "Retry-After": "0" }
      }))
      .mockResolvedValueOnce(okImageResponse("retried"));
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestProviderJson = await loadRequestProviderJson();

    const result = requestProviderJson<{ id: string }>("muzhi", "/v1/images/generations", requestInit);

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ id: "retried" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("holds new Muzhi requests until a shared 429 cooldown expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "slow down" } }), {
        status: 429,
        headers: { "Retry-After": "0" }
      }))
      .mockImplementation(() => Promise.resolve(okImageResponse("ok")));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const requestProviderJson = await loadRequestProviderJson();

    const first = requestProviderJson<{ id: string }>("muzhi", "/v1/images/generations", requestInit);
    await flushMicrotasks();
    const second = requestProviderJson<{ id: string }>("muzhi", "/v1/images/generations", requestInit);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(Promise.all([first, second])).resolves.toEqual([{ id: "ok" }, { id: "ok" }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
