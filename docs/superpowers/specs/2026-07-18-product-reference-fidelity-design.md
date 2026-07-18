# Product Reference Fidelity Design

## Goal

Prevent the style reference image from changing the product's color, material, bottle shape, label, logo, text, or structure. The product reference is the authoritative visual source for every generated image.

## Confirmed Strategy

The style reference image is used only by the prompt-generation model to extract composition, lighting, color mood, environment, and photographic treatment. It is not sent to the image-generation provider.

Image generation uses these references:

- Standard and master-scene image: product reference only.
- Anchored derived image: product reference first, approved master-scene image second.
- The style image is never included in an image-generation request.

This avoids ambiguous multi-image editing where the provider treats visual traits from the style image as product traits.

## Prompt Roles

The image-generation instruction must state the role of every transmitted image:

- `产品参考图`: highest-priority subject constraint. Preserve product transparency, material, color, silhouette, cap, label, logo, text, proportions, and structure.
- `主场景图`: environment constraint for derived views. Preserve the environment, set dressing, props, lighting, and product placement while changing only the requested camera angle.

The role-aware instruction itself must be sent to the provider as the generation prompt. It must not be used only to select reference images and then discarded.

## Existing And New Batches

The rule is applied when preparing each request, so it also fixes retries from batches already stored in the browser. No batch migration is required.

## Payload Behavior

- Muzhi master-scene requests use `/v1/images/edits` with one product image.
- Muzhi derived requests use `/v1/images/edits` with product plus the optimized master-scene image.
- APIMart and Yunwu follow the same semantic reference set: product only for the master image, product plus master scene for derived images.
- Existing master-scene compression remains active for payload safety.

## Tests

- A master-scene job sends only the product reference even when the batch stores a style reference.
- A standard job sends only the product reference.
- A derived job sends product then master scene, with no style reference.
- The provider receives the role-aware product-preservation instruction.
- Existing payload optimization, queue, workflow, provider, type-check, and build tests remain green.
