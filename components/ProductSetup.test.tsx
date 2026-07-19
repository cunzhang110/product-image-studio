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

const dispatchDragEnter = (target: Element, type = "image/png") => {
  const event = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { items: [{ kind: "file", type }] }
  });
  target.dispatchEvent(event);
};

const dispatchDragLeave = (target: Element) => {
  target.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
};

const dispatchFileChange = (target: HTMLInputElement, file: File) => {
  Object.defineProperty(target, "files", { configurable: true, value: [file] });
  target.dispatchEvent(new Event("change", { bubbles: true }));
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

  it("ignores a non-image selected through the file input", async () => {
    const onProductImageSelected = vi.fn();
    const { container } = await mountSetup({ onProductImageSelected });
    const input = container.querySelector<HTMLInputElement>(".reference-card.product input[type=\"file\"]");

    expect(input).not.toBeNull();
    await act(async () => {
      dispatchFileChange(input!, new File(["notes"], "notes.txt", { type: "text/plain" }));
    });

    expect(onProductImageSelected).not.toHaveBeenCalled();
  });

  it("tracks drag-active state through enter, leave, and image or non-image drop", async () => {
    const onProductImageSelected = vi.fn();
    const { container } = await mountSetup({ onProductImageSelected });
    const productCard = container.querySelector(".reference-card.product");

    expect(productCard).not.toBeNull();
    await act(async () => {
      dispatchDragEnter(productCard!);
    });
    expect(productCard?.classList.contains("drag-active")).toBe(true);

    await act(async () => {
      dispatchDragLeave(productCard!);
    });
    expect(productCard?.classList.contains("drag-active")).toBe(false);

    await act(async () => {
      dispatchDragEnter(productCard!);
      dispatchDrop(productCard!, [new File(["image"], "wine.png", { type: "image/png" })]);
    });
    expect(productCard?.classList.contains("drag-active")).toBe(false);
    expect(onProductImageSelected).toHaveBeenCalledTimes(1);

    await act(async () => {
      dispatchDragEnter(productCard!);
      dispatchDrop(productCard!, [new File(["notes"], "notes.txt", { type: "text/plain" })]);
    });
    expect(productCard?.classList.contains("drag-active")).toBe(false);
    expect(onProductImageSelected).toHaveBeenCalledTimes(1);
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
