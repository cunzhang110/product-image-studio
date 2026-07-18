import { buildOpenRouterPayload } from "../request.js";

const readJsonBody = async request => {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: { message: "Method not allowed." } });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    response.status(500).json({ error: { message: "OpenRouter API Key is not configured on the server." } });
    return;
  }

  try {
    const payload = buildOpenRouterPayload(await readJsonBody(request));
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://chanpinshengtu.vercel.app",
        "X-Title": "Product Image Studio"
      },
      body: JSON.stringify(payload)
    });
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const upstreamBody = Buffer.from(await upstream.arrayBuffer());
    response.status(upstream.status);
    response.setHeader("Content-Type", contentType);
    response.send(upstreamBody);
  } catch (error) {
    response.status(502).json({
      error: { message: error instanceof Error ? error.message : "OpenRouter proxy request failed." }
    });
  }
}
