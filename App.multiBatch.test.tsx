// @vitest-environment jsdom

import { act, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createProductBatch,
  type ImageGeneration,
  type ImageJobStatus,
  type ProductBatch,
  type PromptVariant
} from "./domain/productWorkflow";
import type { ServiceProvider } from "./types";

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

const stateUpdateMocks = vi.hoisted(() => ({
  track: false,
  calls: 0
}));

vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initialState: T | (() => T)) => {
      const [state, setState] = actual.useState(initialState);
      const trackedSetState: Dispatch<SetStateAction<T>> = value => {
        if (stateUpdateMocks.track) stateUpdateMocks.calls += 1;
        setState(value);
      };
      return [state, trackedSetState] as const;
    }
  };
});

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

const imageJob = (
  batchId: string,
  index: number,
  provider: ServiceProvider,
  status: ImageJobStatus = "stopped",
  resultUrl?: string
): ImageGeneration => ({
  id: `${batchId}-image-${index}`,
  batchId,
  promptVariantId: `${batchId}-prompt-${index}`,
  promptSnapshot: `${batchId} prompt ${index}`,
  productReferenceImageSnapshot: `data:image/png;base64,${batchId}`,
  styleReferenceImageSnapshot: "",
  role: "standard",
  provider,
  model: provider === "yunwu" ? "gemini-3.1-flash-image-preview" : "gpt-image-2",
  aspectRatio: "3:4",
  imageSize: "2K",
  status,
  resultUrl,
  error: status === "failed" ? "request failed" : undefined,
  createdAt: index
});

const resumableBatch = (
  id: string,
  imageProvider: ServiceProvider,
  images: ImageGeneration[]
): ProductBatch => ({
  ...readyMuzhiBatch(id, images.length),
  imageProvider,
  imageModel: imageProvider === "yunwu" ? "gemini-3.1-flash-image-preview" : "gpt-image-2",
  concurrency: 3,
  stage: "results",
  runPhase: "stopped",
  images
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

const clickRetry = async (container: HTMLDivElement, promptText: string) => {
  const item = Array.from(container.querySelectorAll<HTMLElement>(".result-item"))
    .find(result => result.textContent?.includes(promptText));
  const button = item?.querySelector<HTMLButtonElement>("button[title='重试']");
  expect(button, `retry ${promptText}`).not.toBeNull();
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const rangeForLabel = (container: HTMLDivElement, labelText: string) => {
  const label = Array.from(container.querySelectorAll<HTMLLabelElement>("label"))
    .find(item => item.textContent?.includes(labelText));
  expect(label, `label containing ${labelText}`).not.toBeUndefined();
  expect(label?.control, `control labelled ${labelText}`).toBeInstanceOf(HTMLInputElement);
  const control = label!.control as HTMLInputElement;
  expect(control.type).toBe("range");
  return control;
};

const setRangeValue = async (control: HTMLInputElement, value: number) => {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(control, String(value));
    control.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
};

const schedulerStat = (container: HTMLDivElement, label: string) => {
  const stat = Array.from(container.querySelectorAll<HTMLElement>(".scheduler-stats > div"))
    .find(item => item.querySelector("span")?.textContent === label);
  expect(stat, `scheduler stat ${label}`).not.toBeUndefined();
  return stat?.querySelector("strong")?.textContent;
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
    stateUpdateMocks.track = false;
    stateUpdateMocks.calls = 0;
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

  it("associates stable accessible labels with the Muzhi and per-batch sliders", async () => {
    const { container } = await mountApp();

    const muzhiControl = rangeForLabel(container, "Muzhi 全局并发");
    expect(muzhiControl.id).toBe("muzhi-global-concurrency");
    expect(muzhiControl.min).toBe("1");
    expect(muzhiControl.max).toBe("10");

    await clickButton(container, "APIMart");

    const apimartControl = rangeForLabel(container, "批次并发数量");
    expect(apimartControl.id).toBe("batch-concurrency");
    expect(apimartControl.min).toBe("1");
    expect(apimartControl.max).toBe("3");
  });

  it("persists Muzhi slider changes and reports active and queued scheduler work", async () => {
    dbMocks.loadBatches.mockResolvedValue([readyMuzhiBatch("A", 6)]);
    const { container } = await mountApp();
    dbMocks.saveMuzhiConcurrency.mockClear();

    const muzhiControl = rangeForLabel(container, "Muzhi 全局并发");
    expect(muzhiControl.value).toBe("7");
    await setRangeValue(muzhiControl, 5);
    await flushWork();

    expect(container.textContent).toContain("5 / 10");
    expect(muzhiControl.value).toBe("5");
    expect(dbMocks.saveMuzhiConcurrency).toHaveBeenCalledWith(5);

    await clickButton(container, "生成已选 6 张");
    expect(schedulerStat(container, "实际生成")).toBe("1");
    expect(schedulerStat(container, "排队任务")).toBe("5");
    expect(schedulerStat(container, "运行批次")).toBe("1");

    await clickButton(container, "停止生成");
    expect(schedulerStat(container, "排队任务")).toBe("0");
    await act(async () => {
      deferredWork.get("A prompt 1")?.resolve("data:image/png;base64,QQ==");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(schedulerStat(container, "实际生成")).toBe("0");
    expect(schedulerStat(container, "排队任务")).toBe("0");
    expect(schedulerStat(container, "运行批次")).toBe("0");
  });

  it("keeps a retried Muzhi snapshot behind the shared scheduler after the batch switches provider", async () => {
    const blocking = readyMuzhiBatch("A", 1);
    const switched = resumableBatch("B", "apimart", [imageJob("B", 1, "muzhi", "failed")]);
    dbMocks.loadBatches.mockResolvedValue([blocking, switched]);
    dbMocks.loadMuzhiConcurrency.mockResolvedValue(1);
    const { container } = await mountApp();

    await clickButton(container, "生成已选 1 张");
    await clickBatch(container, "B");
    await clickRetry(container, "B prompt 1");

    expect(deferredWork.has("A prompt 1")).toBe(true);
    expect(deferredWork.has("B prompt 1")).toBe(false);

    await act(async () => {
      deferredWork.get("A prompt 1")?.resolve("data:image/png;base64,QQ==");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(deferredWork.has("B prompt 1")).toBe(true);
  });

  it("routes mixed resume jobs by snapshot provider and preserves their original order", async () => {
    const mixed = resumableBatch("M", "muzhi", [
      imageJob("M", 1, "apimart"),
      imageJob("M", 2, "muzhi"),
      imageJob("M", 3, "apimart")
    ]);
    dbMocks.loadBatches.mockResolvedValue([mixed]);
    const { container } = await mountApp();

    await clickButton(container, "继续剩余任务");

    expect(deferredWork.has("M prompt 1")).toBe(true);
    expect(deferredWork.has("M prompt 2")).toBe(true);
    expect(deferredWork.has("M prompt 3")).toBe(true);
    expect(Array.from(container.querySelectorAll<HTMLElement>(".result-item"))
      .map(item => item.querySelector("p")?.textContent)).toEqual([
      "M prompt 1",
      "M prompt 2",
      "M prompt 3"
    ]);

    await act(async () => {
      deferredWork.get("M prompt 3")?.resolve("data:image/png;base64,TQMz");
      deferredWork.get("M prompt 1")?.resolve("data:image/png;base64,TQMx");
      deferredWork.get("M prompt 2")?.resolve("data:image/png;base64,TQMy");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const items = Array.from(container.querySelectorAll<HTMLElement>(".result-item"));
    expect(items.map(item => item.querySelector("p")?.textContent)).toEqual([
      "M prompt 1",
      "M prompt 2",
      "M prompt 3"
    ]);
    expect(items.map(item => item.querySelector("img")?.getAttribute("src"))).toEqual([
      "data:image/png;base64,TQMx",
      "data:image/png;base64,TQMy",
      "data:image/png;base64,TQMz"
    ]);
  });

  it("retries a middle image in place without changing neighbors or numbering", async () => {
    const batch = resumableBatch("R", "apimart", [
      imageJob("R", 1, "apimart", "completed", "data:image/png;base64,UjE="),
      imageJob("R", 2, "apimart", "failed"),
      imageJob("R", 3, "apimart", "completed", "data:image/png;base64,UjM=")
    ]);
    dbMocks.loadBatches.mockResolvedValue([batch]);
    const { container } = await mountApp();

    await clickRetry(container, "R prompt 2");

    let items = Array.from(container.querySelectorAll<HTMLElement>(".result-item"));
    expect(items.map(item => item.querySelector("p")?.textContent)).toEqual([
      "R prompt 1",
      "R prompt 2",
      "R prompt 3"
    ]);
    expect(items.map(item => item.querySelector(".result-number")?.textContent)).toEqual(["01", "02", "03"]);
    expect(items[0].querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,UjE=");
    expect(items[2].querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,UjM=");

    await act(async () => {
      deferredWork.get("R prompt 2")?.resolve("data:image/png;base64,UjI=");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    items = Array.from(container.querySelectorAll<HTMLElement>(".result-item"));
    expect(items.map(item => item.querySelector("p")?.textContent)).toEqual([
      "R prompt 1",
      "R prompt 2",
      "R prompt 3"
    ]);
    expect(items.map(item => item.querySelector("img")?.getAttribute("src"))).toEqual([
      "data:image/png;base64,UjE=",
      "data:image/png;base64,UjI=",
      "data:image/png;base64,UjM="
    ]);
    expect(items.map(item => item.querySelector(".result-number")?.textContent)).toEqual(["01", "02", "03"]);
  });

  it("does not dispatch state updates when teardown settles an abort-ignoring worker late", async () => {
    dbMocks.loadBatches.mockResolvedValue([readyMuzhiBatch("L", 1)]);
    const app = await mountApp();
    await clickButton(app.container, "生成已选 1 张");
    const deferred = deferredWork.get("L prompt 1");
    expect(deferred).not.toBeUndefined();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    stateUpdateMocks.track = true;
    await unmountApp(app);
    expect(runSignals.get("L")?.aborted).toBe(true);
    await act(async () => {
      deferred?.resolve("data:image/png;base64,TA==");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(stateUpdateMocks.calls).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
