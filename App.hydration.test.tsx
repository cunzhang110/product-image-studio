// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createProductBatch, DEFAULT_PRODUCT_PROMPT_TEMPLATE, type ProductBatch } from "./domain/productWorkflow";

const dbMocks = vi.hoisted(() => ({
  loadBatches: vi.fn(),
  loadPreference: vi.fn(),
  loadMuzhiConcurrency: vi.fn(),
  saveBatches: vi.fn(),
  savePreference: vi.fn(),
  saveMuzhiConcurrency: vi.fn()
}));

vi.mock("./utils/db", () => ({
  loadProductBatchesFromDB: dbMocks.loadBatches,
  loadPromptTemplatePreference: dbMocks.loadPreference,
  loadMuzhiConcurrencyPreference: dbMocks.loadMuzhiConcurrency,
  saveProductBatchesToDB: dbMocks.saveBatches,
  savePromptTemplatePreference: dbMocks.savePreference,
  saveMuzhiConcurrencyPreference: dbMocks.saveMuzhiConcurrency
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

const editTemplate = async (container: HTMLDivElement, value: string) => {
  const template = activeTemplate(container);
  expect(template).not.toBeNull();
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    valueSetter?.call(template, value);
    template?.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
};

describe("App workspace hydration", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    dbMocks.loadBatches.mockReset();
    dbMocks.loadPreference.mockReset();
    dbMocks.loadMuzhiConcurrency.mockReset().mockResolvedValue(7);
    dbMocks.saveBatches.mockReset().mockResolvedValue(undefined);
    dbMocks.savePreference.mockReset().mockResolvedValue(undefined);
    dbMocks.saveMuzhiConcurrency.mockReset().mockResolvedValue(undefined);
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

  it("shows the batch real-photo finish setting", async () => {
    dbMocks.loadBatches.mockResolvedValue([createProductBatch("质感设置")]);
    dbMocks.loadPreference.mockResolvedValue(null);
    const { container } = await mountApp();
    await flushHydration();
    expect(container.textContent).toContain("实拍质感");
    expect(container.textContent).toContain("轻微");
    expect(container.textContent).toContain("自然");
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

    const newBatchButton = container.querySelector<HTMLButtonElement>(".new-batch-button");
    await act(async () => {
      newBatchButton?.click();
    });
    expect(activeTemplate(container)?.value).toBe(DEFAULT_PRODUCT_PROMPT_TEMPLATE);
  });

  it("blocks editing after a batch read failure and restores saved batches after retry", async () => {
    const storedBatch = createProductBatch("重试恢复批次", "重试恢复模板");
    dbMocks.loadBatches
      .mockRejectedValueOnce(new Error("batches unavailable"))
      .mockRejectedValueOnce(new Error("batches still unavailable"))
      .mockResolvedValueOnce([storedBatch]);
    dbMocks.loadPreference.mockResolvedValue("可用模板");

    const { container } = await mountApp();
    await flushHydration();

    expect(container.textContent).toContain("批次加载失败");
    expect(container.querySelector(".studio-layout")).toBeNull();
    expect(activeTemplate(container)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(dbMocks.saveBatches).not.toHaveBeenCalled();

    const retryButton = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("重试加载"));
    expect(retryButton).not.toBeUndefined();
    await act(async () => {
      retryButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("批次加载失败");
    expect(container.querySelector(".studio-layout")).toBeNull();
    expect(dbMocks.saveBatches).not.toHaveBeenCalled();

    const secondRetryButton = Array.from(container.querySelectorAll("button"))
      .find(button => button.textContent?.includes("重试加载"));
    await act(async () => {
      secondRetryButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".studio-layout")).not.toBeNull();
    expect(activeTemplate(container)?.value).toBe("重试恢复模板");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(dbMocks.saveBatches).toHaveBeenLastCalledWith([storedBatch]);
  });

  it("shows and recovers a persistent batch-save error without leaking a rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    dbMocks.loadBatches.mockResolvedValue([createProductBatch("待保存批次")]);
    dbMocks.loadPreference.mockResolvedValue(null);
    dbMocks.saveBatches
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);

    try {
      const { container } = await mountApp();
      await flushHydration();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();
      });

      expect(container.querySelector("[role='alert']")?.textContent).toContain("批次自动保存失败");
      expect(container.querySelector(".topbar-status")?.textContent).not.toContain("本地自动保存");
      expect(unhandled).not.toHaveBeenCalled();

      await editTemplate(container, "触发批次重试保存");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
        await Promise.resolve();
      });
      expect(container.querySelector("[role='alert']")).toBeNull();
      expect(container.querySelector(".topbar-status")?.textContent).toContain("本地自动保存");
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("shows and recovers a persistent template-save error without leaking a rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    dbMocks.loadBatches.mockResolvedValue([createProductBatch("模板保存批次")]);
    dbMocks.loadPreference.mockResolvedValue(null);
    dbMocks.savePreference
      .mockRejectedValueOnce(new Error("settings unavailable"))
      .mockResolvedValue(undefined);

    try {
      const { container } = await mountApp();
      await flushHydration();
      await editTemplate(container, "无法保存的模板");

      expect(container.querySelector("[role='alert']")?.textContent).toContain("模板偏好保存失败");
      expect(unhandled).not.toHaveBeenCalled();

      await editTemplate(container, "可以保存的模板");
      expect(container.querySelector("[role='alert']")).toBeNull();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("uses an edited template for a new batch without changing another stored batch", async () => {
    const editedBatch = createProductBatch("编辑来源批次", "来源模板");
    const untouchedBatch = createProductBatch("未修改批次", "保持原样模板");
    dbMocks.loadBatches.mockResolvedValue([editedBatch, untouchedBatch]);
    dbMocks.loadPreference.mockResolvedValue("旧偏好");

    const { container } = await mountApp();
    await flushHydration();
    await editTemplate(container, "新继承模板");

    const newBatchButton = container.querySelector<HTMLButtonElement>(".new-batch-button");
    await act(async () => {
      newBatchButton?.click();
    });
    expect(activeTemplate(container)?.value).toBe("新继承模板");

    const untouchedButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".batch-item"))
      .find(button => button.textContent?.includes("未修改批次"));
    await act(async () => {
      untouchedButton?.click();
    });
    expect(activeTemplate(container)?.value).toBe("保持原样模板");
  });

  it("uses the edited template when replacing the final batch", async () => {
    const storedBatch = createProductBatch("最后一个批次", "旧模板");
    dbMocks.loadBatches.mockResolvedValue([storedBatch]);
    dbMocks.loadPreference.mockResolvedValue("旧模板");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = await mountApp();
    await flushHydration();

    await editTemplate(container, "删除后继承模板");
    const deleteButton = container.querySelector<HTMLButtonElement>(".delete-batch-button");
    expect(deleteButton).not.toBeNull();
    await act(async () => {
      deleteButton?.click();
    });
    expect(activeTemplate(container)?.value).toBe("删除后继承模板");
  });
});
