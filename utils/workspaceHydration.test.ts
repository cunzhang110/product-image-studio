import { describe, expect, it } from "vitest";
import {
  createPreferredProductBatch,
  hydrateProductWorkspace,
  isProductWorkspaceReady
} from "./workspaceHydration";
import { createProductBatch, DEFAULT_PRODUCT_PROMPT_TEMPLATE } from "../domain/productWorkflow";

describe("product workspace hydration", () => {
  it("keeps loaded batches and enables their persistence when the preference read fails", async () => {
    const storedBatch = createProductBatch("已保存批次", "已保存的批次模板");

    const workspace = await hydrateProductWorkspace({
      loadBatches: async () => [storedBatch],
      loadPreference: async () => {
        throw new Error("preference unavailable");
      },
      loadMuzhiConcurrency: async () => {
        throw new Error("concurrency preference unavailable");
      }
    });

    expect(workspace.batches).toEqual([storedBatch]);
    expect(workspace.promptTemplatePreference).toBe(DEFAULT_PRODUCT_PROMPT_TEMPLATE);
    expect(workspace.muzhiGlobalConcurrency).toBe(7);
    expect(workspace.canPersistBatches).toBe(true);
  });

  it("hydrates a stored Muzhi global concurrency preference", async () => {
    const workspace = await hydrateProductWorkspace({
      loadBatches: async () => [],
      loadPreference: async () => null,
      loadMuzhiConcurrency: async () => 5
    });

    expect(workspace.muzhiGlobalConcurrency).toBe(5);
  });

  it("uses the default Muzhi concurrency when the preference is absent", async () => {
    const workspace = await hydrateProductWorkspace({
      loadBatches: async () => [],
      loadPreference: async () => null,
      loadMuzhiConcurrency: async () => null
    });

    expect(workspace.muzhiGlobalConcurrency).toBe(7);
  });

  it("does not permit automatic batch persistence when batch hydration fails", async () => {
    const workspace = await hydrateProductWorkspace({
      loadBatches: async () => {
        throw new Error("batches unavailable");
      },
      loadPreference: async () => "用户模板",
      loadMuzhiConcurrency: async () => 5
    });

    expect(workspace.batches).toHaveLength(1);
    expect(workspace.batches[0].promptTemplate).toBe("用户模板");
    expect(workspace.canPersistBatches).toBe(false);
  });

  it("keeps the workspace unavailable until hydration finishes", () => {
    const batch = createProductBatch("等待加载");

    expect(isProductWorkspaceReady(false, batch)).toBe(false);
    expect(isProductWorkspaceReady(true, batch)).toBe(true);
  });

  it("creates the replacement for a final deletion with the saved preference", () => {
    const replacement = createPreferredProductBatch("我的产品批次", "保留我的模板");

    expect(replacement.promptTemplate).toBe("保留我的模板");
  });
});
