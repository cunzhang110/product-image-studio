import {
  DEFAULT_PRODUCT_PROMPT_TEMPLATE,
  createProductBatch,
  type ProductBatch
} from "../domain/productWorkflow";
import {
  DEFAULT_MUZHI_GLOBAL_CONCURRENCY,
  normalizeMuzhiGlobalConcurrency
} from "../domain/muzhiConcurrency";

interface ProductWorkspaceLoaders {
  loadBatches: () => Promise<ProductBatch[]>;
  loadPreference: () => Promise<string | null>;
  loadMuzhiConcurrency: () => Promise<number | null>;
}

interface HydratedProductWorkspace {
  batches: ProductBatch[];
  promptTemplatePreference: string;
  muzhiGlobalConcurrency: number;
  canPersistBatches: boolean;
}

export const createPreferredProductBatch = (name: string, promptTemplate: string) => (
  createProductBatch(name, promptTemplate)
);

export const hydrateProductWorkspace = async ({
  loadBatches,
  loadPreference,
  loadMuzhiConcurrency
}: ProductWorkspaceLoaders): Promise<HydratedProductWorkspace> => {
  const [batchesResult, preferenceResult, muzhiConcurrencyResult] = await Promise.allSettled([
    loadBatches(),
    loadPreference(),
    loadMuzhiConcurrency()
  ]);
  const promptTemplatePreference = preferenceResult.status === "fulfilled"
    ? preferenceResult.value ?? DEFAULT_PRODUCT_PROMPT_TEMPLATE
    : DEFAULT_PRODUCT_PROMPT_TEMPLATE;
  const canPersistBatches = batchesResult.status === "fulfilled";
  const muzhiGlobalConcurrency = normalizeMuzhiGlobalConcurrency(
    muzhiConcurrencyResult.status === "fulfilled" && muzhiConcurrencyResult.value !== null
      ? muzhiConcurrencyResult.value
      : DEFAULT_MUZHI_GLOBAL_CONCURRENCY
  );
  const batches = canPersistBatches && batchesResult.value.length
    ? batchesResult.value
    : [createPreferredProductBatch("我的产品批次", promptTemplatePreference)];

  return { batches, promptTemplatePreference, muzhiGlobalConcurrency, canPersistBatches };
};

export const isProductWorkspaceReady = (hydrated: boolean, activeBatch?: ProductBatch) => (
  hydrated && Boolean(activeBatch)
);
