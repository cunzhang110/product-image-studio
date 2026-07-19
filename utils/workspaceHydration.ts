import {
  DEFAULT_PRODUCT_PROMPT_TEMPLATE,
  createProductBatch,
  type ProductBatch
} from "../domain/productWorkflow";

interface ProductWorkspaceLoaders {
  loadBatches: () => Promise<ProductBatch[]>;
  loadPreference: () => Promise<string | null>;
}

interface HydratedProductWorkspace {
  batches: ProductBatch[];
  promptTemplatePreference: string;
  canPersistBatches: boolean;
}

export const createPreferredProductBatch = (name: string, promptTemplate: string) => (
  createProductBatch(name, promptTemplate)
);

export const hydrateProductWorkspace = async ({
  loadBatches,
  loadPreference
}: ProductWorkspaceLoaders): Promise<HydratedProductWorkspace> => {
  const [batchesResult, preferenceResult] = await Promise.allSettled([
    loadBatches(),
    loadPreference()
  ]);
  const promptTemplatePreference = preferenceResult.status === "fulfilled"
    ? preferenceResult.value ?? DEFAULT_PRODUCT_PROMPT_TEMPLATE
    : DEFAULT_PRODUCT_PROMPT_TEMPLATE;
  const canPersistBatches = batchesResult.status === "fulfilled";
  const batches = canPersistBatches && batchesResult.value.length
    ? batchesResult.value
    : [createPreferredProductBatch("我的产品批次", promptTemplatePreference)];

  return { batches, promptTemplatePreference, canPersistBatches };
};

export const isProductWorkspaceReady = (hydrated: boolean, activeBatch?: ProductBatch) => (
  hydrated && Boolean(activeBatch)
);
