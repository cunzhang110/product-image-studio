// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ResultGallery } from "./ResultGallery";
import { createImageJobs, createProductBatch } from "../domain/productWorkflow";

describe("ResultGallery photo finish", () => {
  it("shows finished output, toggles to original, and requests re-finishing", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const batch = createProductBatch();
    batch.prompts = [{ id: "p", prompt: "scene", selected: true, status: "ready", createdAt: 1, updatedAt: 1 }];
    const [base] = createImageJobs(batch);
    const job = { ...base, status: "completed" as const, resultUrl: "original.jpg", finishedResultUrl: "finished.jpg" };
    const onRefinish = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<ResultGallery images={[job]} onRetry={vi.fn()} onRefinish={onRefinish} />));

    expect(container.querySelector("img")?.getAttribute("src")).toBe("finished.jpg");
    await act(async () => container.querySelector<HTMLButtonElement>("button[title='查看原图']")?.click());
    expect(container.querySelector("img")?.getAttribute("src")).toBe("original.jpg");
    await act(async () => container.querySelector<HTMLButtonElement>("button[title='重新优化']")?.click());
    expect(onRefinish).toHaveBeenCalledWith(job);

    await act(async () => root.unmount());
  });
});
