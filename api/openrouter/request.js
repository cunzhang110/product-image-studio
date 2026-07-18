export const OPENROUTER_PROMPT_MODEL = "qwen/qwen3.5-9b";

export const buildOpenRouterPayload = (body = {}) => ({
  ...body,
  model: OPENROUTER_PROMPT_MODEL,
  messages: Array.isArray(body.messages) ? body.messages : []
});

const RETRY_DELAYS_MS = [1500, 3500, 7000];

const wait = delay => new Promise(resolve => setTimeout(resolve, delay));

export const requestOpenRouterWithRetry = async (fetcher, url, options, sleep = wait) => {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetcher(url, options);
    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt === RETRY_DELAYS_MS.length) return response;

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const headerDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 15000)
      : null;
    await response.arrayBuffer().catch(() => undefined);
    await sleep(headerDelay ?? RETRY_DELAYS_MS[attempt]);
  }
  throw new Error("OpenRouter retry loop ended unexpectedly.");
};

export const getOpenRouterErrorMessage = (status, bodyText) => {
  try {
    const data = JSON.parse(bodyText);
    if (status === 429) {
      return "Qwen3.5 模型当前繁忙，系统已自动重试 3 次。请稍等一两分钟后再生成提示词。";
    }
    if (status === 503) {
      return "Qwen3.5 模型暂时不可用，系统已自动重试。请稍后再试。";
    }
    return data?.error?.metadata?.raw || data?.error?.message || `OpenRouter 请求失败 (${status})`;
  } catch {
    return status === 429
      ? "Qwen3.5 模型当前繁忙，请稍后再试。"
      : `OpenRouter 请求失败 (${status})`;
  }
};
