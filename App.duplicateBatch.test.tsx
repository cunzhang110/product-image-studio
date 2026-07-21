// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createImageJobs, createProductBatch, type ProductBatch } from "./domain/productWorkflow";

const dbMocks = vi.hoisted(() => ({
  loadBatches: vi.fn(),
  loadPreference: vi.fn(),
  loadMuzhiConcurrency: vi.fn(),
  saveBatches: vi.fn(),
  savePreference: vi.fn(),
  saveMuzhiConcurrency: vi.fn()
}));

const imageMocks = vi.hoisted(() => ({
  generateImage: vi.fn()
}));

vi.mock("./utils/db", () => ({
  loadProductBatchesFromDB: dbMocks.loadBatches,
  loadPromptTemplatePreference: dbMocks.loadPreference,
  loadMuzhiConcurrencyPreference: dbMocks.loadMuzhiConcurrency,
  saveProductBatchesToDB: dbMocks.saveBatches,
  savePromptTemplatePreference: dbMocks.savePreference,
  saveMuzhiConcurrencyPreference: dbMocks.saveMuzhiConcurrency
}));

vi.mock("./services/geminiService", () => ({
  generateImage: imageMocks.generateImage
}));

interface MountedApp {
  container: HTMLDivElement;
  root: Root;
}

const mountedApps: MountedApp[] = [];

const mountApp = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const app = { container, root };
  mountedApps.push(app);
  await act(async () => {
    root.render(<App />);
  });
  return app;
};

const flushHydration = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const buttonWithText = (container: HTMLDivElement, text: string) => (
  Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find(button => button.textContent?.includes(text))
);

describe("App product batch duplication", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    dbMocks.loadBatches.mockReset();
    dbMocks.loadPreference.mockReset().mockResolvedValue(null);
    dbMocks.loadMuzhiConcurrency.mockReset().mockResolvedValue(7);
    dbMocks.saveBatches.mockReset().mockResolvedValue(undefined);
    dbMocks.savePreference.mockReset().mockResolvedValue(undefined);
    dbMocks.saveMuzhiConcurrency.mockReset().mockResolvedValue(undefined);
    imageMocks.generateImage.mockReset();
  });

  afterEach(async () => {
    for (const { root, container } of mountedApps.splice(0)) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("copies the active batch, selects it, clears results, and persists both batches", async () => {
    const source = createProductBatch("婚宴酒");
    source.productReferenceImage = "data:image/png;base64,product";
    source.styleReferenceImage = "data:image/png;base64,style";
    source.creativeGuide = "婚宴场景";
    source.stage = "results";
    source.runPhase = "completed";
    source.prompts = [{ id: "prompt-1", prompt: "宴会桌面", selected: true, status: "ready", createdAt: 1, updatedAt: 1 }];
    source.images = [{
      ...createImageJobs(source)[0],
      status: "completed",
      resultUrl: "data:image/png;base64,result"
    }];
    dbMocks.loadBatches.mockResolvedValue([source]);

    const { container } = await mountApp();
    await flushHydration();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".duplicate-batch-button")?.click();
    });

    const items = container.querySelectorAll(".batch-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("婚宴酒 - 副本");
    expect(items[0].classList.contains("active")).toBe(true);
    expect(items[0].textContent).toContain("0 条提示词 · 0 张完成");
    expect(container.textContent).toContain("已复制产品批次");

    await act(async () => vi.advanceTimersByTimeAsync(250));
    const saved = dbMocks.saveBatches.mock.calls.at(-1)?.[0] as ProductBatch[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ name: "婚宴酒 - 副本", creativeGuide: "", prompts: [], images: [], stage: "setup", runPhase: "idle" });
    expect(saved[1]).toEqual(source);
  });

  it("copies a clean setup batch without aborting the active source run", async () => {
    const source = createProductBatch("运行中批次");
    source.productReferenceImage = "data:image/png;base64,product";
    source.stage = "review";
    source.prompts = [{ id: "prompt-1", prompt: "运行中 prompt", selected: true, status: "ready", createdAt: 1, updatedAt: 1 }];
    dbMocks.loadBatches.mockResolvedValue([source]);
    let sourceSignal: AbortSignal | undefined;
    imageMocks.generateImage.mockImplementation((...args: unknown[]) => {
      sourceSignal = args.at(-1) as AbortSignal;
      return new Promise(() => {});
    });

    const { container } = await mountApp();
    await flushHydration();
    await act(async () => {
      buttonWithText(container, "生成已选 1 张")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const copyButton = container.querySelector<HTMLButtonElement>(".duplicate-batch-button");
    expect(copyButton?.disabled).toBe(false);
    await act(async () => copyButton?.click());
    expect(container.querySelectorAll(".batch-item")).toHaveLength(2);
    expect(container.querySelector(".batch-item.active")?.textContent).toContain("0 条提示词 · 0 张完成");
    expect(sourceSignal?.aborted).toBe(false);
  });
});
