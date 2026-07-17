import { describe, expect, it } from "vitest";
import type { ImageGeneration } from "../domain/productWorkflow";
import { runProductImageJobs } from "./productImageQueue";

const makeJob = (id: string): ImageGeneration => ({
  id,
  batchId: "batch",
  promptVariantId: `prompt-${id}`,
  promptSnapshot: `场景 ${id}`,
  referenceImageSnapshot: "data:image/png;base64,abc",
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
});
