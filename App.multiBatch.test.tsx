// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createProductBatch, type ProductBatch, type PromptVariant } from "./domain/productWorkflow";

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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface MountedApp {
  container: HTMLDivElement;
  root: Root;
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const prompt = (batchId: string, index: number): PromptVariant => ({
  id: `${batchId}-prompt-${index}`,
  prompt: `${batchId} prompt ${index}`,
  selected: true,
  status: "ready",
  createdAt: index,
  updatedAt: index
});

const readyMuzhiBatch = (id: string, promptCount: number): ProductBatch => ({
  ...createProductBatch(id),
  id,
  name: id,
  productReferenceImage: `data:image/png;base64,${id}`,
  imageProvider: "muzhi",
  imageModel: "gpt-image-2",
  stage: "review",
  prompts: Array.from({ length: promptCount }, (_, index) => prompt(id, index + 1))
});

const mountedApps: MountedApp[] = [];
let runSignals: Map<string, AbortSignal>;
let deferredWork: Map<string, Deferred<string>>;

const flushWork = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const mountApp = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const app = { container, root };
  mountedApps.push(app);

  await act(async () => {
    root.render(<App />);
  });
  await flushWork();
  return app;
};

const buttonWithText = (container: HTMLDivElement, text: string) => (
  Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find(button => button.textContent?.includes(text))
);

const clickButton = async (container: HTMLDivElement, text: string) => {
  const button = buttonWithText(container, text);
  expect(button, `button containing ${text}`).not.toBeUndefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const clickBatch = async (container: HTMLDivElement, batchId: string) => {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".batch-item"))
    .find(item => item.textContent?.includes(batchId));
  expect(button, `batch ${batchId}`).not.toBeUndefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
};

const startBothBatches = async (container: HTMLDivElement) => {
  await clickButton(container, "生成已选 2 张");
  await clickBatch(container, "B");
  expect(buttonWithText(container, "生成已选 1 张")).not.toBeUndefined();
  await clickButton(container, "生成已选 1 张");
  await flushWork();
};

const unmountApp = async (app: MountedApp) => {
  const index = mountedApps.indexOf(app);
  if (index >= 0) mountedApps.splice(index, 1);
  await act(async () => {
    app.root.unmount();
  });
  app.container.remove();
};

describe("App multi-batch Muzhi orchestration", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    runSignals = new Map();
    deferredWork = new Map();
    dbMocks.loadBatches.mockReset().mockResolvedValue([
      readyMuzhiBatch("A", 2),
      readyMuzhiBatch("B", 1)
    ]);
    dbMocks.loadPreference.mockReset().mockResolvedValue(null);
    dbMocks.loadMuzhiConcurrency.mockReset().mockResolvedValue(7);
    dbMocks.saveBatches.mockReset().mockResolvedValue(undefined);
    dbMocks.savePreference.mockReset().mockResolvedValue(undefined);
    dbMocks.saveMuzhiConcurrency.mockReset().mockResolvedValue(undefined);
    imageMocks.generateImage.mockReset().mockImplementation((promptText: string, ...args: unknown[]) => {
      const batchId = promptText.split(" ")[0];
      const signal = args.at(-1) as AbortSignal;
      const deferred = createDeferred<string>();
      runSignals.set(batchId, signal);
      deferredWork.set(promptText, deferred);
      return deferred.promise;
    });
  });

  afterEach(async () => {
    for (const app of mountedApps.splice(0)) {
      await act(async () => {
        app.root.unmount();
      });
      app.container.remove();
    }
    vi.restoreAllMocks();
  });

  it("runs A and B together and stops only the selected batch", async () => {
    const { container } = await mountApp();

    await startBothBatches(container);

    expect(runSignals.get("A")?.aborted).toBe(false);
    expect(runSignals.get("B")?.aborted).toBe(false);

    await act(async () => {
      deferredWork.get("A prompt 1")?.resolve("data:image/png;base64,QQ==");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deferredWork.has("A prompt 2")).toBe(true);

    await clickBatch(container, "A");
    expect(buttonWithText(container, "停止生成")).not.toBeUndefined();
    await clickButton(container, "停止生成");

    expect(runSignals.get("A")?.aborted).toBe(true);
    expect(runSignals.get("B")?.aborted).toBe(false);
    const completedA = Array.from(container.querySelectorAll<HTMLElement>(".result-item"))
      .find(item => item.textContent?.includes("A prompt 1"));
    expect(completedA?.textContent).toContain("已完成");

    await clickBatch(container, "B");
    expect(buttonWithText(container, "停止生成")).not.toBeUndefined();
  });

  it("aborts every active batch when the app unmounts", async () => {
    const app = await mountApp();
    await startBothBatches(app.container);

    expect(runSignals.get("A")?.aborted).toBe(false);
    expect(runSignals.get("B")?.aborted).toBe(false);

    await unmountApp(app);

    expect(runSignals.get("A")?.aborted).toBe(true);
    expect(runSignals.get("B")?.aborted).toBe(true);
  });
});
