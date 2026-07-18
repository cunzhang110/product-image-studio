import { describe, expect, it } from "vitest";
import type { ImageGeneration } from "../domain/productWorkflow";
import { buildJobReferencePrompt, buildJobReferences, prepareJobReferencesForRequest, runProductImageJobs } from "./productImageQueue";

const makeJob = (id: string): ImageGeneration => ({
  id,
  batchId: "batch",
  promptVariantId: `prompt-${id}`,
  promptSnapshot: `场景 ${id}`,
  productReferenceImageSnapshot: "data:image/png;base64,product",
  styleReferenceImageSnapshot: "data:image/png;base64,style",
  role: "standard",
  provider: "yunwu",
  model: "gemini-3.1-flash-image-preview",
  aspectRatio: "3:4",
  imageSize: "2K",
  status: "idle",
  createdAt: 1
});

describe("product image queue", () => {
  it("respects concurrency and returns every successful result", async () => {
    let active = 0;
    let maxActive = 0;
    const jobs = [makeJob("1"), makeJob("2"), makeJob("3")];

    const result = await runProductImageJobs(jobs, 2, async job => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return `data:image/png;base64,${job.id}`;
    });

    expect(maxActive).toBe(2);
    expect(result.every(job => job.status === "completed")).toBe(true);
    expect(result.map(job => job.resultUrl)).toEqual([
      "data:image/png;base64,1",
      "data:image/png;base64,2",
      "data:image/png;base64,3"
    ]);
  });

  it("keeps successful jobs when another job fails", async () => {
    const result = await runProductImageJobs([makeJob("good"), makeJob("bad")], 1, async job => {
      if (job.id === "bad") throw new Error("渠道不可用");
      return "data:image/png;base64,good";
    });

    expect(result[0].status).toBe("completed");
    expect(result[1].status).toBe("failed");
    expect(result[1].error).toBe("渠道不可用");
  });

  it("uses only the product reference for a standard image", () => {
    expect(buildJobReferences(makeJob("standard")).map(item => item.name)).toEqual(["产品参考图"]);
  });

  it("uses only the product reference for a master scene", () => {
    const job = { ...makeJob("anchor"), role: "anchor" as const };
    expect(buildJobReferences(job).map(item => item.name)).toEqual(["产品参考图"]);
  });

  it("orders product then master scene for a derived image", () => {
    const job = { ...makeJob("derived"), role: "derived" as const, anchorReferenceImageSnapshot: "data:image/png;base64,anchor" };
    expect(buildJobReferences(job).map(item => item.name)).toEqual(["产品参考图", "主场景图"]);
  });

  it("sends explicit product fidelity roles without a style-image role", () => {
    const job = { ...makeJob("derived"), role: "derived" as const, anchorReferenceImageSnapshot: "data:image/png;base64,anchor" };
    const prompt = buildJobReferencePrompt(job);
    expect(prompt).toContain("颜色、透明度、材质");
    expect(prompt).toContain("主场景图");
    expect(prompt).not.toContain("风格参考图");
  });

  it("allows a derived prompt to request product actions while keeping the scene locked", () => {
    const job = {
      ...makeJob("action"),
      role: "derived" as const,
      anchorReferenceImageSnapshot: "data:image/png;base64,anchor",
      promptSnapshot: "允许产品位置、人物手势和使用状态按指令变化；人物手持酒瓶。"
    };
    const prompt = buildJobReferencePrompt(job);

    expect(prompt).toContain("严格按提示词执行机位或产品动作");
    expect(prompt).toContain("提示词未要求变化的产品位置和状态保持不变");
    expect(prompt).not.toContain("锁定环境、布景、道具、光线和产品位置，只改变提示词指定的机位");
  });

  it("creates a lightweight master-scene snapshot before a derived request", async () => {
    const job = { ...makeJob("derived"), provider: "muzhi" as const, model: "gpt-image-2", role: "derived" as const, anchorReferenceImageSnapshot: "data:image/png;base64,very-large-anchor" };
    const optimize = async (image: string) => image.includes("very-large-anchor")
      ? "data:image/jpeg;base64,small-anchor"
      : image;
    const references = await prepareJobReferencesForRequest(job, optimize);
    expect(references.map(item => item.imageData)).toEqual([
      job.productReferenceImageSnapshot,
      "data:image/jpeg;base64,small-anchor"
    ]);
  });

  it("preserves completed work and stops dispatching after cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    const completed = { ...makeJob("done"), status: "completed" as const, resultUrl: "data:image/png;base64,done" };

    const result = await runProductImageJobs(
      [completed, makeJob("active"), makeJob("waiting")],
      1,
      async () => {
        calls += 1;
        controller.abort();
        throw new DOMException("Stopped", "AbortError");
      },
      undefined,
      controller.signal
    );

    expect(calls).toBe(1);
    expect(result.map(job => job.status)).toEqual(["completed", "stopped", "stopped"]);
    expect(result[0].resultUrl).toBe("data:image/png;base64,done");
  });
});
