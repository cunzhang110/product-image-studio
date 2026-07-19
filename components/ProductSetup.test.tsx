// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProductBatch } from "../domain/productWorkflow";
import { ProductSetup } from "./ProductSetup";

interface MountedSetup {
  container: HTMLDivElement;
  root: Root;
}

const mountedSetups: MountedSetup[] = [];

const mountSetup = async (overrides: Partial<ComponentProps<typeof ProductSetup>> = {}) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const setup = { container, root };
  mountedSetups.push(setup);

  await act(async () => {
    root.render(
      <ProductSetup
        batch={createProductBatch()}
        loading={false}
        onPatch={vi.fn()}
        onStyleImageSelected={vi.fn()}
        onProductImageSelected={vi.fn()}
        onGenerate={vi.fn()}
        onPromptTemplateChange={vi.fn()}
        {...overrides}
      />
    );
  });

  return setup;
};

const dispatchDrop = (target: Element, files: File[]) => {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  target.dispatchEvent(event);
};

describe("ProductSetup", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    for (const { root, container } of mountedSetups.splice(0)) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("forwards an image dropped on the product card and ignores a non-image", async () => {
    const onProductImageSelected = vi.fn();
    const { container } = await mountSetup({ onProductImageSelected });
    const productCard = container.querySelector(".reference-card.product");

    expect(productCard).not.toBeNull();
    await act(async () => {
      dispatchDrop(productCard!, [new File(["image"], "wine.png", { type: "image/png" })]);
      dispatchDrop(productCard!, [new File(["notes"], "notes.txt", { type: "text/plain" })]);
    });

    expect(onProductImageSelected).toHaveBeenCalledTimes(1);
    expect(onProductImageSelected).toHaveBeenCalledWith(expect.objectContaining({ name: "wine.png" }));
  });

  it("forwards prompt template edits through the preference callback", async () => {
    const onPromptTemplateChange = vi.fn();
    const { container } = await mountSetup({ onPromptTemplateChange });
    const template = container.querySelector<HTMLTextAreaElement>("textarea");

    expect(template).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      valueSetter?.call(template, "新的模板");
      template?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onPromptTemplateChange).toHaveBeenCalledWith("新的模板");
  });
});
