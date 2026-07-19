// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createProductBatch, type ProductBatch } from "./domain/productWorkflow";

const dbMocks = vi.hoisted(() => ({
  loadBatches: vi.fn(),
  loadPreference: vi.fn(),
  saveBatches: vi.fn(),
  savePreference: vi.fn()
}));

vi.mock("./utils/db", () => ({
  loadProductBatchesFromDB: dbMocks.loadBatches,
  loadPromptTemplatePreference: dbMocks.loadPreference,
  saveProductBatchesToDB: dbMocks.saveBatches,
  savePromptTemplatePreference: dbMocks.savePreference
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
  });
};

const activeTemplate = (container: HTMLDivElement) =>
  container.querySelector<HTMLTextAreaElement>("textarea");

describe("App workspace hydration", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    dbMocks.loadBatches.mockReset();
    dbMocks.loadPreference.mockReset();
    dbMocks.saveBatches.mockReset().mockResolvedValue(undefined);
    dbMocks.savePreference.mockReset().mockResolvedValue(undefined);
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

  it("does not render an editable workspace while hydration is pending", async () => {
    let resolveBatches!: (batches: ProductBatch[]) => void;
    let resolvePreference!: (preference: string | null) => void;
    dbMocks.loadBatches.mockReturnValue(new Promise<ProductBatch[]>(resolve => {
      resolveBatches = resolve;
    }));
    dbMocks.loadPreference.mockReturnValue(new Promise<string | null>(resolve => {
      resolvePreference = resolve;
    }));

    const { container } = await mountApp();

    expect(container.querySelector(".app-shell[aria-busy='true']")).not.toBeNull();
    expect(container.querySelector(".studio-layout")).toBeNull();
    expect(activeTemplate(container)).toBeNull();
    expect(dbMocks.saveBatches).not.toHaveBeenCalled();

    resolveBatches([]);
    resolvePreference(null);
  });

  it("keeps stored batches when the preference read fails instead of saving the default batch", async () => {
    const storedBatch = createProductBatch("已保存批次", "数据库中的模板");
    dbMocks.loadBatches.mockResolvedValue([storedBatch]);
    dbMocks.loadPreference.mockRejectedValue(new Error("preference unavailable"));

    const { container } = await mountApp();
    await flushHydration();

    expect(activeTemplate(container)?.value).toBe("数据库中的模板");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(dbMocks.saveBatches).toHaveBeenCalledTimes(1);
    expect(dbMocks.saveBatches).toHaveBeenLastCalledWith([storedBatch]);
  });

  it("does not save batches after the batch read fails", async () => {
    dbMocks.loadBatches.mockRejectedValue(new Error("batches unavailable"));
    dbMocks.loadPreference.mockResolvedValue("可用模板");

    const { container } = await mountApp();
    await flushHydration();

    expect(activeTemplate(container)?.value).toBe("可用模板");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(dbMocks.saveBatches).not.toHaveBeenCalled();
  });

  it("uses a saved empty template when replacing the final batch", async () => {
    const storedBatch = createProductBatch("最后一个批次", "旧模板");
    dbMocks.loadBatches.mockResolvedValue([storedBatch]);
    dbMocks.loadPreference.mockResolvedValue("");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = await mountApp();
    await flushHydration();

    expect(activeTemplate(container)?.value).toBe("旧模板");
    const deleteButton = container.querySelector<HTMLButtonElement>(".delete-batch-button");
    expect(deleteButton).not.toBeNull();
    await act(async () => {
      deleteButton?.click();
    });
    expect(activeTemplate(container)?.value).toBe("");
  });
});
