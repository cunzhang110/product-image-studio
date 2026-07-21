import { describe, expect, it } from "vitest";
import { applyProductReferenceFilename, buildCustomAnchoredPrompts, buildCustomBranchPrompt, createDefaultWineExtensionNodes, createImageJobs, createProductBatch, DEFAULT_PRODUCT_PROMPT_TEMPLATE, getBatchDisplayStatus, getImageRunPhase, getPlannedImageCount, isSupportedImageFile, normalizeProductBatch, parsePromptList } from "./productWorkflow";

describe("product workflow", () => {
  it.each(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif", "bmp"])(
    "accepts a %s extension when the MIME type is empty",
    extension => {
      expect(isSupportedImageFile({ name: `product.${extension}`, type: "" })).toBe(true);
    }
  );

  it("handles empty and extension-only filenames while rejecting explicit non-images", () => {
    expect(isSupportedImageFile({ name: "", type: "" })).toBe(false);
    expect(isSupportedImageFile({ name: ".png", type: "" })).toBe(true);
    expect(isSupportedImageFile({ name: "product.png", type: "text/plain" })).toBe(false);
    expect(isSupportedImageFile({ name: "", type: "image/png" })).toBe(true);
  });

  it("uses the wine template for new batches and accepts an explicit preference", () => {
    expect(createProductBatch().promptTemplate).toBe(DEFAULT_PRODUCT_PROMPT_TEMPLATE);
    expect(createProductBatch("产品", "用户模板").promptTemplate).toBe("用户模板");
    expect(createProductBatch("产品", "").promptTemplate).toBe("");
    expect(createProductBatch().creativeGuide).toBe("");
  });

  it("creates a dual-reference product batch with Qwen prompt generation", () => {
    const batch = createProductBatch("新品饮料");

    expect(batch.name).toBe("新品饮料");
    expect(batch.styleReferenceImage).toBe("");
    expect(batch.productReferenceImage).toBe("");
    expect(batch.prompts).toEqual([]);
    expect(batch.promptProvider).toBe("openrouter");
    expect(batch.promptModel).toBe("qwen/qwen3.5-9b");
    expect(batch.sameSceneBranchMode).toBe("ai-random");
    expect(batch.extensionNodes).toEqual([]);
  });

  it("migrates persisted prompt settings to the fixed OpenRouter model", () => {
    const legacy = {
      ...createProductBatch("旧批次"),
      referenceImage: "data:image/png;base64,legacy-product",
      productReferenceImage: undefined,
      styleReferenceImage: undefined,
      promptProvider: "yunwu",
      promptModel: "gemini-3-pro-preview"
    } as any;

    expect(normalizeProductBatch(legacy)).toMatchObject({
      promptProvider: "openrouter",
      promptModel: "qwen/qwen3.5-9b",
      productReferenceImage: "data:image/png;base64,legacy-product",
      styleReferenceImage: ""
    });
  });

  it("parses a JSON prompt array and removes empty duplicates", () => {
    expect(parsePromptList('["场景 A", "场景 A", "", "场景 B"]')).toEqual([
      "场景 A",
      "场景 B"
    ]);
  });

  it("falls back to newline prompts", () => {
    expect(parsePromptList("场景 A\n\n场景 B\n场景 A")).toEqual(["场景 A", "场景 B"]);
  });

  it("creates image jobs only for selected prompts", () => {
    const batch = createProductBatch("产品");
    batch.productReferenceImage = "data:image/png;base64,product";
    batch.styleReferenceImage = "data:image/png;base64,style";
    batch.prompts = [
      { id: "p1", prompt: "A", selected: true, status: "ready", createdAt: 1, updatedAt: 1 },
      { id: "p2", prompt: "B", selected: false, status: "ready", createdAt: 1, updatedAt: 1 }
    ];

    const jobs = createImageJobs(batch);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].promptSnapshot).toBe("A");
    expect(jobs[0].productReferenceImageSnapshot).toBe(batch.productReferenceImage);
    expect(jobs[0].styleReferenceImageSnapshot).toBe(batch.styleReferenceImage);
  });

  it("migrates old batches to the existing manual varied-scene workflow", () => {
    const legacy = createProductBatch("旧批次") as any;
    delete legacy.workflowMode;
    delete legacy.promptStrategy;
    delete legacy.runPhase;
    delete legacy.nameSource;
    delete legacy.sameSceneBranchMode;
    delete legacy.extensionNodes;

    expect(normalizeProductBatch(legacy)).toMatchObject({
      workflowMode: "manual",
      promptStrategy: "varied-scenes",
      runPhase: "idle",
      nameSource: "manual",
      sameSceneBranchMode: "ai-random",
      extensionNodes: []
    });
  });

  it("uses the product filename until the batch is manually named", () => {
    const automatic = { ...createProductBatch(), nameSource: "automatic" as const };
    expect(applyProductReferenceFilename(automatic, "婚宴产品.jpg").name).toBe("婚宴产品");
    expect(applyProductReferenceFilename({ ...automatic, name: "婚宴系列", nameSource: "manual" }, "新图.png").name).toBe("婚宴系列");
  });

  it("derives batch display states with queued, generating, and terminal precedence", () => {
    const batch = createProductBatch();
    const prompt = { id: "a", prompt: "A", selected: true, status: "ready" as const, createdAt: 1, updatedAt: 1 };
    const jobs = createImageJobs({ ...batch, prompts: Array.from({ length: 5 }, (_, index) => ({ ...prompt, id: `${prompt.id}-${index}` })) });
    const withStatuses = (statuses: Array<(typeof jobs)[number]["status"]>) => ({
      ...batch,
      runPhase: "generating-images" as const,
      images: jobs.map((job, index) => ({ ...job, status: statuses[index] }))
    });

    expect(getBatchDisplayStatus(withStatuses(["queued", "queued", "queued", "queued", "queued"]))).toEqual({ tone: "blue", label: "排队中" });
    expect(getBatchDisplayStatus(withStatuses(["completed", "generating", "queued", "queued", "queued"]))).toEqual({ tone: "blue", label: "生图中 1/5" });
    expect(getBatchDisplayStatus({ ...withStatuses(["completed", "failed", "failed", "failed", "failed"]), runPhase: "completed" })).toEqual({ tone: "orange", label: "部分完成" });
    expect(getBatchDisplayStatus({ ...withStatuses(["completed", "completed", "completed", "completed", "completed"]), runPhase: "completed" })).toEqual({ tone: "green", label: "已完成" });
    expect(getBatchDisplayStatus({ ...withStatuses(["completed", "stopped", "stopped", "stopped", "stopped"]), runPhase: "completed" })).toEqual({ tone: "orange", label: "部分完成" });
    expect(getBatchDisplayStatus({ ...withStatuses(["stopped", "stopped", "stopped", "stopped", "stopped"]), runPhase: "stopped" })).toEqual({ tone: "orange", label: "已停止" });
  });

  it("shows a stopped batch as an orange resumable state", () => {
    const batch = createProductBatch();
    batch.runPhase = "stopped";
    expect(getBatchDisplayStatus(batch)).toEqual({ tone: "orange", label: "已停止" });
  });

  it("settles a retry instead of leaving the batch generating", () => {
    const batch = createProductBatch();
    batch.productReferenceImage = "data:image/png;base64,product";
    batch.prompts = [{ id: "a", prompt: "A", selected: true, status: "ready", createdAt: 1, updatedAt: 1 }];
    const [job] = createImageJobs(batch);
    expect(getImageRunPhase([{ ...job, status: "completed" }])).toBe("completed");
    expect(getImageRunPhase([{ ...job, status: "failed" }])).toBe("failed");
    expect(getImageRunPhase([{ ...job, status: "stopped" }])).toBe("stopped");
  });

  it("creates the editable five-node wine bottle template", () => {
    const nodes = createDefaultWineExtensionNodes();
    expect(nodes).toHaveLength(5);
    expect(nodes.map(node => node.type)).toEqual(["camera", "camera", "camera", "action", "camera-action"]);
    expect(nodes.map(node => node.instruction)).toEqual([
      "左侧 45 度酒瓶近景，保持瓶身标签正面清晰可见",
      "顶部俯拍场景全景，完整展示桌面布置与酒瓶位置",
      "低机位瓶身与标签细节特写，背景轻微虚化",
      "人物手持酒瓶，瓶身标签正对镜头",
      "打开酒瓶并向酒杯倒酒，保持原场景与产品外观一致"
    ]);
    expect(new Set(nodes.map(node => node.id)).size).toBe(5);
  });

  it("derives custom output quantity from the branch nodes", () => {
    const batch = createProductBatch();
    batch.promptStrategy = "anchored-angles";
    batch.sameSceneBranchMode = "custom-map";
    batch.extensionNodes = createDefaultWineExtensionNodes().slice(0, 3);
    expect(getPlannedImageCount(batch)).toBe(4);
    batch.sameSceneBranchMode = "ai-random";
    expect(getPlannedImageCount(batch)).toBe(batch.requestedPromptCount);
  });

  it("compiles type-specific custom branch locks", () => {
    const [camera, , , action, combined] = createDefaultWineExtensionNodes();
    const cameraPrompt = buildCustomBranchPrompt("固定婚宴桌面", camera);
    const actionPrompt = buildCustomBranchPrompt("固定婚宴桌面", action);
    const combinedPrompt = buildCustomBranchPrompt("固定婚宴桌面", combined);

    expect(cameraPrompt).toContain("只允许改变摄影机方向");
    expect(cameraPrompt).toContain("产品状态和摆放位置保持不变");
    expect(actionPrompt).toContain("允许产品位置、人物手势和使用状态按指令变化");
    expect(actionPrompt).toContain("镜头风格保持不变");
    expect(combinedPrompt).toContain("允许机位和产品动作按指令同时变化");
    expect([cameraPrompt, actionPrompt, combinedPrompt].every(prompt => prompt.includes("透明度"))).toBe(true);
  });

  it("places the master prompt before custom branches", () => {
    const batch = createProductBatch();
    batch.extensionNodes = createDefaultWineExtensionNodes().slice(0, 2);
    expect(buildCustomAnchoredPrompts(batch, "主场景提示词", "固定婚宴桌面")).toEqual([
      "主场景提示词",
      buildCustomBranchPrompt("固定婚宴桌面", batch.extensionNodes[0]),
      buildCustomBranchPrompt("固定婚宴桌面", batch.extensionNodes[1])
    ]);
  });
});
