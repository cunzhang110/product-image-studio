import { describe, expect, it, vi } from "vitest";
import { createDefaultWineExtensionNodes, createProductBatch, type ImageGeneration, type ProductBatch } from "../domain/productWorkflow";
import { continueManualAnchoredBatch, resumeProductBatch, runAutomaticProductBatch, startManualAnchoredBatch, type ProductBatchWorkflowDependencies } from "./productBatchWorkflow";

const batchWithRefs = (patch: Partial<ProductBatch> = {}) => ({
  ...createProductBatch("产品"),
  productReferenceImage: "data:image/png;base64,product",
  styleReferenceImage: "data:image/png;base64,style",
  requestedPromptCount: 3,
  ...patch
});

const dependencies = (): ProductBatchWorkflowDependencies => ({
  generatePromptPlan: async batch => batch.promptStrategy === "anchored-angles"
    ? { strategy: "anchored-angles", sceneBible: "固定婚宴桌面", anchorPrompt: "主场景", anglePrompts: ["第二机位", "第三机位"] }
    : { strategy: "varied-scenes", prompts: ["场景一", "场景二", "场景三"] },
  runJobs: async (_batch, jobs, onJobs) => {
    const completed = jobs.map(job => ({ ...job, status: "completed" as const, resultUrl: `data:image/png;base64,${job.role}-${job.id}` }));
    onJobs(completed);
    return completed;
  }
});

describe("product batch workflow", () => {
  it("runs automatic varied scenes through final images", async () => {
    const result = await runAutomaticProductBatch(batchWithRefs({ workflowMode: "automatic" }), dependencies(), vi.fn());
    expect(result.prompts).toHaveLength(3);
    expect(result.images).toHaveLength(3);
    expect(result.runPhase).toBe("completed");
  });

  it("counts the anchor as image one and shares it with derived jobs", async () => {
    const result = await runAutomaticProductBatch(batchWithRefs({ workflowMode: "automatic", promptStrategy: "anchored-angles" }), dependencies(), vi.fn());
    expect(result.images).toHaveLength(3);
    expect(result.images[0].role).toBe("anchor");
    expect(result.images.slice(1).every(job => job.anchorReferenceImageSnapshot === result.images[0].resultUrl)).toBe(true);
  });

  it("manual anchored mode pauses after the anchor and continues on approval", async () => {
    const paused = await startManualAnchoredBatch(batchWithRefs({ promptStrategy: "anchored-angles" }), dependencies(), vi.fn());
    expect(paused.runPhase).toBe("awaiting-anchor-approval");
    expect(paused.images).toHaveLength(1);
    const completed = await continueManualAnchoredBatch(paused, dependencies(), vi.fn());
    expect(completed.images).toHaveLength(3);
    expect(completed.runPhase).toBe("completed");
  });

  it("stops when the anchor fails", async () => {
    const deps = dependencies();
    deps.runJobs = async (_batch, jobs) => jobs.map(job => ({ ...job, status: "failed", error: "主场景失败" })) as ImageGeneration[];
    const result = await runAutomaticProductBatch(batchWithRefs({ workflowMode: "automatic", promptStrategy: "anchored-angles" }), deps, vi.fn());
    expect(result.runPhase).toBe("failed");
    expect(result.images).toHaveLength(1);
  });

  it("returns a stopped batch when prompt generation is aborted", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.generatePromptPlan = async () => {
      controller.abort();
      throw new DOMException("Stopped", "AbortError");
    };

    const result = await runAutomaticProductBatch(
      batchWithRefs({ workflowMode: "automatic" }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(result.runPhase).toBe("stopped");
    expect(result.runError).toBeUndefined();
  });

  it("keeps automatic master-scene cancellation as stopped", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.runJobs = async (_batch, jobs, onJobs) => {
      controller.abort();
      const stopped = jobs.map(job => ({ ...job, status: "stopped" as const }));
      onJobs(stopped);
      return stopped;
    };

    const result = await runAutomaticProductBatch(
      batchWithRefs({ workflowMode: "automatic", promptStrategy: "anchored-angles" }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(result.runPhase).toBe("stopped");
  });

  it("keeps manual master-scene cancellation as stopped", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.runJobs = async (_batch, jobs, onJobs) => {
      controller.abort();
      const stopped = jobs.map(job => ({ ...job, status: "stopped" as const }));
      onJobs(stopped);
      return stopped;
    };

    const result = await startManualAnchoredBatch(
      batchWithRefs({ promptStrategy: "anchored-angles" }),
      deps,
      vi.fn(),
      controller.signal
    );

    expect(result.runPhase).toBe("stopped");
  });

  it("resumes only unfinished standard jobs", async () => {
    const initial = await runAutomaticProductBatch(batchWithRefs({ workflowMode: "automatic" }), dependencies(), vi.fn());
    const stopped = {
      ...initial,
      runPhase: "stopped" as const,
      images: initial.images.map((job, index) => index === 0
        ? job
        : { ...job, status: "stopped" as const, resultUrl: undefined })
    };
    const deps = dependencies();
    const runJobs = vi.fn(deps.runJobs);
    deps.runJobs = runJobs;

    const result = await resumeProductBatch(stopped, deps, vi.fn(), new AbortController().signal);

    expect(runJobs.mock.calls[0][1]).toHaveLength(2);
    expect(result.images[0].resultUrl).toBe(initial.images[0].resultUrl);
    expect(result.images.every(job => job.status === "completed")).toBe(true);
  });

  it("reuses a completed master scene when resuming derived views", async () => {
    const initial = await runAutomaticProductBatch(
      batchWithRefs({ workflowMode: "automatic", promptStrategy: "anchored-angles" }),
      dependencies(),
      vi.fn()
    );
    const stopped = {
      ...initial,
      runPhase: "stopped" as const,
      images: initial.images.map((job, index) => index === 0
        ? job
        : { ...job, status: "stopped" as const, resultUrl: undefined })
    };
    const deps = dependencies();
    const runJobs = vi.fn(deps.runJobs);
    deps.runJobs = runJobs;

    const result = await resumeProductBatch(stopped, deps, vi.fn(), new AbortController().signal);

    expect(runJobs.mock.calls[0][1].every(job => job.role === "derived")).toBe(true);
    expect(result.images[0].id).toBe(initial.images[0].id);
    expect(result.images[0].resultUrl).toBe(initial.images[0].resultUrl);
  });

  it("runs automatic custom branches in node order", async () => {
    const nodes = createDefaultWineExtensionNodes().slice(0, 2);
    const deps = dependencies();
    deps.generatePromptPlan = async () => ({
      strategy: "anchored-angles",
      sceneBible: "固定婚宴桌面",
      anchorPrompt: "主场景",
      anglePrompts: []
    });

    const result = await runAutomaticProductBatch(batchWithRefs({
      workflowMode: "automatic",
      promptStrategy: "anchored-angles",
      sameSceneBranchMode: "custom-map",
      extensionNodes: nodes
    }), deps, vi.fn());

    expect(result.images).toHaveLength(3);
    expect(result.images[0].role).toBe("anchor");
    expect(result.images[1].promptSnapshot).toContain(nodes[0].instruction);
    expect(result.images[2].promptSnapshot).toContain(nodes[1].instruction);
  });

  it("rebuilds manual custom branches after node edits without regenerating the master", async () => {
    const nodes = createDefaultWineExtensionNodes().slice(0, 2);
    const deps = dependencies();
    deps.generatePromptPlan = async () => ({
      strategy: "anchored-angles",
      sceneBible: "固定婚宴桌面",
      anchorPrompt: "主场景",
      anglePrompts: []
    });
    const paused = await startManualAnchoredBatch(batchWithRefs({
      promptStrategy: "anchored-angles",
      sameSceneBranchMode: "custom-map",
      extensionNodes: nodes
    }), deps, vi.fn());
    const anchor = paused.images[0];
    const editedInstruction = "右侧低机位手持酒瓶，标签朝向镜头";

    const completed = await continueManualAnchoredBatch({
      ...paused,
      extensionNodes: [
        { ...nodes[0], instruction: editedInstruction },
        nodes[1]
      ]
    }, deps, vi.fn());

    expect(completed.images).toHaveLength(3);
    expect(completed.images[0].id).toBe(anchor.id);
    expect(completed.images[1].promptSnapshot).toContain(editedInstruction);
    expect(completed.images[1].anchorReferenceImageSnapshot).toBe(anchor.resultUrl);
  });
});
