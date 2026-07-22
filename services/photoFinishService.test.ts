// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { applyPhotoFinish, preferredImageUrl } from "./photoFinishService";
import { createImageJobs, createProductBatch } from "../domain/productWorkflow";

describe("photo finish service", () => {
  it("returns the original image when finishing is off", async () => {
    await expect(applyPhotoFinish("data:image/png;base64,original", "off"))
      .resolves.toBe("data:image/png;base64,original");
  });

  it("prefers the finished image without losing the original", () => {
    const batch = createProductBatch();
    batch.prompts = [{ id: "p", prompt: "scene", selected: true, status: "ready", createdAt: 1, updatedAt: 1 }];
    const [job] = createImageJobs(batch);
    expect(preferredImageUrl({ ...job, resultUrl: "original", finishedResultUrl: "finished" })).toBe("finished");
    expect(preferredImageUrl({ ...job, resultUrl: "original" })).toBe("original");
  });

  it("keeps canvas dimensions and exports a finished data URL", async () => {
    let canvasWidth = 0;
    let canvasHeight = 0;
    const result = await applyPhotoFinish("source", "subtle", {
      loadImage: async () => ({ width: 1200, height: 1600 } as HTMLImageElement),
      createCanvas: () => ({
        get width() { return canvasWidth; },
        set width(value: number) { canvasWidth = value; },
        get height() { return canvasHeight; },
        set height(value: number) { canvasHeight = value; },
        getContext: () => ({
          drawImage: () => undefined,
          getImageData: () => ({ data: new Uint8ClampedArray(16) }),
          putImageData: () => undefined
        }),
        toDataURL: () => "data:image/jpeg;base64,finished"
      } as unknown as HTMLCanvasElement)
    });

    expect([canvasWidth, canvasHeight]).toEqual([1200, 1600]);
    expect(result).toBe("data:image/jpeg;base64,finished");
  });

  it("falls back to the original image when local processing fails", async () => {
    await expect(applyPhotoFinish("original", "natural", {
      loadImage: async () => { throw new Error("decode failed"); },
      createCanvas: () => document.createElement("canvas")
    })).resolves.toBe("original");
  });
});
