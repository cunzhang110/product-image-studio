import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  Download,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  Plus,
  RefreshCw,
  Settings2,
  Square,
  Sparkles,
  Trash2,
  WandSparkles
} from "lucide-react";
import { ProductSetup } from "./components/ProductSetup";
import { BatchStatusBadge } from "./components/BatchStatusBadge";
import { PromptReview } from "./components/PromptReview";
import { ProviderSettings } from "./components/ProviderSettings";
import { ResultGallery } from "./components/ResultGallery";
import {
  DEFAULT_PRODUCT_PROMPT_TEMPLATE,
  createImageJobs,
  applyProductReferenceFilename,
  getBatchDisplayStatus,
  getImageRunPhase,
  getPlannedImageCount,
  promptsToVariants,
  type ImageGeneration,
  type ProductBatch
} from "./domain/productWorkflow";
import { DEFAULT_MUZHI_GLOBAL_CONCURRENCY } from "./domain/muzhiConcurrency";
import { generateImage } from "./services/geminiService";
import { buildJobReferencePrompt, isGenerationAbort, prepareJobReferencesForRequest, runProductImageJobs } from "./services/productImageQueue";
import { generateProductPromptPlan, generateProductPrompts } from "./services/productPromptService";
import { continueManualAnchoredBatch, resumeProductBatch, runAutomaticProductBatch, startManualAnchoredBatch, type ProductBatchWorkflowDependencies } from "./services/productBatchWorkflow";
import { BatchRunRegistry } from "./services/batchRunRegistry";
import { MuzhiBatchScheduler, type MuzhiSchedulerSnapshot } from "./services/muzhiBatchScheduler";
import type { ImageSize, ServiceProvider } from "./types";
import {
  loadMuzhiConcurrencyPreference,
  loadProductBatchesFromDB,
  loadPromptTemplatePreference,
  saveMuzhiConcurrencyPreference,
  saveProductBatchesToDB,
  savePromptTemplatePreference
} from "./utils/db";
import {
  createPreferredProductBatch,
  hydrateProductWorkspace,
  isProductWorkspaceReady
} from "./utils/workspaceHydration";

const IMAGE_MODELS: Record<ServiceProvider, string> = {
  yunwu: "gemini-3.1-flash-image-preview",
  apimart: "gpt-image-2",
  muzhi: "gpt-image-2"
};

const PROVIDER_LABELS: Record<ServiceProvider, string> = {
  yunwu: "云雾",
  apimart: "APIMart",
  muzhi: "Muzhi"
};

const STAGES = [
  { id: "setup", label: "产品设置", icon: Boxes },
  { id: "review", label: "提示词审核", icon: WandSparkles },
  { id: "results", label: "生图结果", icon: ImageIcon }
] as const;

const ASPECT_RATIOS = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"];

const imageFileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("读取参考图失败"));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error("参考图格式无法识别"));
    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    image.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
});

const App: React.FC = () => {
  const initialBatchRef = useRef(createPreferredProductBatch("我的产品批次", DEFAULT_PRODUCT_PROMPT_TEMPLATE));
  const [batches, setBatches] = useState<ProductBatch[]>([initialBatchRef.current]);
  const [activeBatchId, setActiveBatchId] = useState(initialBatchRef.current.id);
  const [promptTemplatePreference, setPromptTemplatePreference] = useState(DEFAULT_PRODUCT_PROMPT_TEMPLATE);
  const [hydrated, setHydrated] = useState(false);
  const [canPersistBatches, setCanPersistBatches] = useState(false);
  const [batchLoadFailed, setBatchLoadFailed] = useState(false);
  const [batchPersistenceError, setBatchPersistenceError] = useState(false);
  const [preferencePersistenceError, setPreferencePersistenceError] = useState(false);
  const [muzhiPreferencePersistenceError, setMuzhiPreferencePersistenceError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appending, setAppending] = useState(false);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [runningBatchIds, setRunningBatchIds] = useState<Set<string>>(new Set());
  const [muzhiGlobalConcurrency, setMuzhiGlobalConcurrency] = useState(DEFAULT_MUZHI_GLOBAL_CONCURRENCY);
  const [muzhiSnapshot, setMuzhiSnapshot] = useState<MuzhiSchedulerSnapshot>({
    limit: DEFAULT_MUZHI_GLOBAL_CONCURRENCY,
    activeCount: 0,
    queuedCount: 0,
    runningBatchCount: 0
  });
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const runRegistryRef = useRef<BatchRunRegistry | null>(null);
  if (!runRegistryRef.current) {
    runRegistryRef.current = new BatchRunRegistry(setRunningBatchIds);
  }
  const muzhiSchedulerRef = useRef<MuzhiBatchScheduler | null>(null);
  if (!muzhiSchedulerRef.current) {
    muzhiSchedulerRef.current = new MuzhiBatchScheduler(DEFAULT_MUZHI_GLOBAL_CONCURRENCY, setMuzhiSnapshot);
  }
  const mountedRef = useRef(false);
  const hydrationAttemptRef = useRef(0);
  const preferenceSaveAttemptRef = useRef(0);
  const muzhiPreferenceSaveAttemptRef = useRef(0);
  const hydratedMuzhiConcurrencyRef = useRef<number | null>(null);

  const activeBatch = useMemo(
    () => batches.find(batch => batch.id === activeBatchId) || batches[0],
    [batches, activeBatchId]
  );

  const loadWorkspace = () => {
    const attempt = ++hydrationAttemptRef.current;
    setHydrated(false);
    setCanPersistBatches(false);
    setBatchLoadFailed(false);
    void hydrateProductWorkspace({
      loadBatches: loadProductBatchesFromDB,
      loadPreference: loadPromptTemplatePreference,
      loadMuzhiConcurrency: loadMuzhiConcurrencyPreference
    }).then(workspace => {
      if (!mountedRef.current || attempt !== hydrationAttemptRef.current) return;
      setPromptTemplatePreference(workspace.promptTemplatePreference);
      hydratedMuzhiConcurrencyRef.current = workspace.muzhiGlobalConcurrency;
      setMuzhiGlobalConcurrency(workspace.muzhiGlobalConcurrency);
      if (!workspace.canPersistBatches) {
        setBatchLoadFailed(true);
        setHydrated(true);
        return;
      }
      setBatches(workspace.batches);
      setActiveBatchId(workspace.batches[0].id);
      setCanPersistBatches(true);
      setHydrated(true);
    }).catch(() => {
      if (!mountedRef.current || attempt !== hydrationAttemptRef.current) return;
      setBatchLoadFailed(true);
      setHydrated(true);
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    loadWorkspace();

    return () => {
      mountedRef.current = false;
      hydrationAttemptRef.current += 1;
      runRegistryRef.current?.stopAll();
      muzhiSchedulerRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    muzhiSchedulerRef.current!.setLimit(muzhiGlobalConcurrency);
  }, [muzhiGlobalConcurrency]);

  useEffect(() => {
    if (!hydrated) return;
    if (hydratedMuzhiConcurrencyRef.current === muzhiGlobalConcurrency) {
      hydratedMuzhiConcurrencyRef.current = null;
      return;
    }
    const attempt = ++muzhiPreferenceSaveAttemptRef.current;
    void Promise.resolve()
      .then(() => saveMuzhiConcurrencyPreference(muzhiGlobalConcurrency))
      .then(() => {
        if (mountedRef.current && attempt === muzhiPreferenceSaveAttemptRef.current) {
          setMuzhiPreferencePersistenceError(false);
        }
      })
      .catch(() => {
        if (mountedRef.current && attempt === muzhiPreferenceSaveAttemptRef.current) {
          setMuzhiPreferencePersistenceError(true);
        }
      });
  }, [hydrated, muzhiGlobalConcurrency]);

  useEffect(() => {
    if (!hydrated || !canPersistBatches) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => saveProductBatchesToDB(batches))
        .then(() => {
          if (active) setBatchPersistenceError(false);
        })
        .catch(() => {
          if (active) setBatchPersistenceError(true);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [batches, canPersistBatches, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, tone: "success" | "error" | "info" = "info") => setToast({ message, tone });

  const beginRun = (batchId: string) => runRegistryRef.current!.begin(batchId);

  const isCurrentRun = (batchId: string, controller: AbortController) => (
    runRegistryRef.current!.isCurrent(batchId, controller)
  );

  const finishRun = (batchId: string, controller: AbortController) => {
    runRegistryRef.current!.finish(batchId, controller);
  };

  const updateBatch = (batchId: string, updater: (batch: ProductBatch) => ProductBatch) => {
    setBatches(current => current.map(batch => batch.id === batchId
      ? { ...updater(batch), updatedAt: Date.now() }
      : batch));
  };

  const patchActiveBatch = (patch: Partial<ProductBatch>) => {
    if (!activeBatch) return;
    updateBatch(activeBatch.id, batch => ({ ...batch, ...patch }));
  };

  const updatePromptTemplate = (promptTemplate: string) => {
    patchActiveBatch({ promptTemplate });
    setPromptTemplatePreference(promptTemplate);
    const attempt = ++preferenceSaveAttemptRef.current;
    void Promise.resolve()
      .then(() => savePromptTemplatePreference(promptTemplate))
      .then(() => {
        if (mountedRef.current && attempt === preferenceSaveAttemptRef.current) {
          setPreferencePersistenceError(false);
        }
      })
      .catch(() => {
        if (mountedRef.current && attempt === preferenceSaveAttemptRef.current) {
          setPreferencePersistenceError(true);
        }
      });
  };

  const createBatch = () => {
    const next = createPreferredProductBatch(`产品批次 ${batches.length + 1}`, promptTemplatePreference);
    setBatches(current => [next, ...current]);
    setActiveBatchId(next.id);
  };

  const deleteBatch = (batchId: string) => {
    if (!window.confirm("确定删除当前产品批次吗？其中的提示词和生图结果也会一起删除。")) return;
    if (batches.length === 1) {
      const next = createPreferredProductBatch("我的产品批次", promptTemplatePreference);
      setBatches([next]);
      setActiveBatchId(next.id);
      return;
    }
    const remaining = batches.filter(batch => batch.id !== batchId);
    setBatches(remaining);
    if (activeBatchId === batchId) setActiveBatchId(remaining[0].id);
  };

  const validatePromptInput = (batch: ProductBatch) => {
    if (!batch.styleReferenceImage) throw new Error("请先上传一张风格参考图");
    if (!batch.name.trim()) throw new Error("请填写产品或批次名称");
    if (batch.promptStrategy === "anchored-angles" && batch.sameSceneBranchMode === "custom-map") {
      if (!batch.extensionNodes.length) throw new Error("请至少添加一个延伸节点");
      const emptyIndex = batch.extensionNodes.findIndex(node => !node.instruction.trim());
      if (emptyIndex >= 0) throw new Error(`请填写第 ${emptyIndex + 1} 个延伸节点的指令`);
    }
  };

  const requestPrompts = async (batch: ProductBatch, count: number, signal?: AbortSignal) => generateProductPrompts({
    productName: batch.name,
    styleReferenceImage: batch.styleReferenceImage,
    promptTemplate: batch.promptTemplate,
    creativeGuide: batch.creativeGuide,
    count
  }, signal);

  const requestPromptPlan = (batch: ProductBatch, signal?: AbortSignal) => generateProductPromptPlan({
    productName: batch.name,
    styleReferenceImage: batch.styleReferenceImage,
    promptTemplate: batch.promptTemplate,
    creativeGuide: batch.creativeGuide,
    count: batch.promptStrategy === "anchored-angles" && batch.sameSceneBranchMode === "custom-map"
      ? 1
      : batch.requestedPromptCount,
    strategy: batch.promptStrategy
  }, signal);

  const generateJobImage = async (job: ImageGeneration, signal?: AbortSignal) => {
    const references = await prepareJobReferencesForRequest(job);
    const referencePrompt = buildJobReferencePrompt(job);
    return generateImage(job.promptSnapshot, job.aspectRatio, job.imageSize, job.provider, references, job.model, referencePrompt, signal);
  };

  const executeBatchJobs: ProductBatchWorkflowDependencies["runJobs"] = (batch, jobs, onJobs, signal) => (
    batch.imageProvider === "muzhi"
      ? muzhiSchedulerRef.current!.enqueue({
        batchId: batch.id,
        jobs,
        worker: generateJobImage,
        onJobs,
        signal
      })
      : runProductImageJobs(
        jobs,
        batch.concurrency,
        job => generateJobImage(job, signal),
        onJobs,
        signal
      )
  );

  const workflowDependencies: ProductBatchWorkflowDependencies = {
    generatePromptPlan: requestPromptPlan,
    runJobs: executeBatchJobs
  };

  const handleGeneratePrompts = async () => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (runningBatchIds.has(batchId)) return;
    const controller = beginRun(batchId);
    try {
      validatePromptInput(activeBatch);
      updateBatch(batchId, batch => ({ ...batch, runPhase: "generating-prompts", runError: undefined }));
      const prompts = await requestPrompts(activeBatch, activeBatch.requestedPromptCount, controller.signal);
      if (!isCurrentRun(batchId, controller)) return;
      updateBatch(batchId, batch => ({ ...batch, prompts: promptsToVariants(prompts), stage: "review", runPhase: "idle" }));
      showToast(`已生成 ${prompts.length} 条提示词，确认后再开始生图`, "success");
    } catch (error) {
      if (controller.signal.aborted || isGenerationAbort(error)) return;
      const message = error instanceof Error ? error.message : "提示词生成失败";
      if (!isCurrentRun(batchId, controller)) return;
      updateBatch(batchId, batch => ({ ...batch, runPhase: "failed", runError: message }));
      showToast(message, "error");
    } finally {
      finishRun(batchId, controller);
    }
  };

  const handleAppendPrompts = async () => {
    if (!activeBatch || appending) return;
    try {
      validatePromptInput(activeBatch);
      setAppending(true);
      const appendCount = Math.min(10, activeBatch.requestedPromptCount);
      const prompts = await requestPrompts(activeBatch, appendCount);
      updateBatch(activeBatch.id, batch => ({ ...batch, prompts: [...batch.prompts, ...promptsToVariants(prompts)] }));
      showToast(`已追加 ${prompts.length} 条提示词`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "追加失败", "error");
    } finally {
      setAppending(false);
    }
  };

  const handleRegeneratePrompt = async (promptId: string) => {
    if (!activeBatch || busyPromptId) return;
    try {
      setBusyPromptId(promptId);
      const prompts = await requestPrompts(activeBatch, 1);
      updateBatch(activeBatch.id, batch => ({
        ...batch,
        prompts: batch.prompts.map(item => item.id === promptId
          ? { ...item, prompt: prompts[0], updatedAt: Date.now() }
          : item)
      }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "重新生成失败", "error");
    } finally {
      setBusyPromptId(null);
    }
  };

  const runJobs = async (batch: ProductBatch, jobs: ImageGeneration[]) => {
    const batchId = batch.id;
    const controller = beginRun(batchId);
    try {
      updateBatch(batchId, current => ({ ...current, images: jobs, stage: "results", runPhase: "generating-images", runError: undefined }));
      const completed = await executeBatchJobs(
        batch,
        jobs,
        nextJobs => {
          if (isCurrentRun(batchId, controller)) {
            updateBatch(batchId, current => ({ ...current, images: nextJobs, stage: "results" }));
          }
        },
        controller.signal
      );
      if (!isCurrentRun(batchId, controller)) return;
      const runPhase = completed.some(job => job.status === "stopped")
        ? "stopped" as const
        : completed.some(job => job.status === "completed") ? "completed" as const : "failed" as const;
      updateBatch(batchId, current => ({ ...current, images: completed, stage: "results", runPhase }));
      const successCount = completed.filter(job => job.status === "completed").length;
      showToast(`本批次完成 ${successCount}/${completed.length} 张`, successCount ? "success" : "error");
    } finally {
      finishRun(batchId, controller);
    }
  };

  const handleSetupStart = async () => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (runningBatchIds.has(batchId)) return;
    if (activeBatch.workflowMode === "manual" && activeBatch.promptStrategy === "varied-scenes") {
      await handleGeneratePrompts();
      return;
    }
    const controller = beginRun(batchId);
    try {
      validatePromptInput(activeBatch);
      if (!activeBatch.productReferenceImage) throw new Error("请先上传产品参考图");
      const onUpdate = (next: ProductBatch) => {
        if (isCurrentRun(batchId, controller)) updateBatch(batchId, () => next);
      };
      const result = activeBatch.workflowMode === "automatic"
        ? await runAutomaticProductBatch(activeBatch, workflowDependencies, onUpdate, controller.signal)
        : await startManualAnchoredBatch(activeBatch, workflowDependencies, onUpdate, controller.signal);
      if (!isCurrentRun(batchId, controller)) return;
      updateBatch(batchId, () => result);
      const completed = result.images.filter(image => image.status === "completed").length;
      showToast(result.runPhase === "failed" ? result.runError || "流程失败" : result.runPhase === "awaiting-anchor-approval" ? "主场景已生成，请确认后继续" : `已完成 ${completed}/${result.images.length} 张`, result.runPhase === "failed" ? "error" : "success");
    } catch (error) {
      if (controller.signal.aborted || isGenerationAbort(error)) return;
      if (!isCurrentRun(batchId, controller)) return;
      showToast(error instanceof Error ? error.message : "流程启动失败", "error");
    } finally {
      finishRun(batchId, controller);
    }
  };

  const handleContinueAnchor = async () => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (runningBatchIds.has(batchId)) return;
    const controller = beginRun(batchId);
    try {
      const result = await continueManualAnchoredBatch(activeBatch, workflowDependencies, next => {
        if (isCurrentRun(batchId, controller)) updateBatch(batchId, () => next);
      }, controller.signal);
      if (!isCurrentRun(batchId, controller)) return;
      updateBatch(batchId, () => result);
      showToast(`本批次完成 ${result.images.filter(image => image.status === "completed").length}/${result.images.length} 张`, "success");
    } catch (error) {
      if (controller.signal.aborted || isGenerationAbort(error)) return;
      if (!isCurrentRun(batchId, controller)) return;
      showToast(error instanceof Error ? error.message : "继续生成失败", "error");
    } finally {
      finishRun(batchId, controller);
    }
  };

  const handleGenerateImages = async () => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (runningBatchIds.has(batchId)) return;
    if (!activeBatch.productReferenceImage) return showToast("请先上传产品参考图再开始生图", "error");
    const jobs = createImageJobs(activeBatch);
    if (!jobs.length) return showToast("请先选择至少一条提示词", "error");
    await runJobs(activeBatch, jobs);
  };

  const handleRetryJob = async (job: ImageGeneration) => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (runningBatchIds.has(batchId)) return;
    const controller = beginRun(batchId);
    const retryJob = { ...job, status: "idle" as const, error: undefined, resultUrl: undefined };
    const otherJobs = activeBatch.images.filter(item => item.id !== job.id);
    try {
      updateBatch(batchId, batch => ({ ...batch, images: [...otherJobs, retryJob], runPhase: "generating-images" }));
      const result = await executeBatchJobs(activeBatch, [retryJob], nextJobs => {
        if (!isCurrentRun(batchId, controller)) return;
        updateBatch(batchId, batch => ({
          ...batch,
          images: batch.images.map(item => item.id === job.id ? nextJobs[0] : item)
        }));
      }, controller.signal);
      if (!isCurrentRun(batchId, controller)) return;
      updateBatch(batchId, batch => {
        const images = batch.images.map(item => item.id === job.id ? result[0] : item);
        return {
          ...batch,
          images,
          runPhase: job.role === "anchor" && result[0].status === "completed"
            ? "awaiting-anchor-approval"
            : getImageRunPhase(images)
        };
      });
    } catch (error) {
      if (controller.signal.aborted || isGenerationAbort(error)) return;
      if (!isCurrentRun(batchId, controller)) return;
      showToast(error instanceof Error ? error.message : "重试失败", "error");
    } finally {
      finishRun(batchId, controller);
    }
  };

  const handleStopGeneration = () => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (!runRegistryRef.current!.has(batchId)) return;
    runRegistryRef.current!.stop(batchId);
    updateBatch(batchId, batch => ({
      ...batch,
      runPhase: "stopped",
      runError: undefined,
      images: batch.images.map(image => ["queued", "generating"].includes(image.status)
        ? { ...image, status: "stopped" as const, error: undefined }
        : image)
    }));
    showToast("生成已停止，已完成的结果已保留", "info");
  };

  const handleResumeGeneration = async () => {
    if (!activeBatch) return;
    const batchId = activeBatch.id;
    if (runningBatchIds.has(batchId)) return;
    const controller = beginRun(batchId);
    try {
      const result = await resumeProductBatch(activeBatch, workflowDependencies, next => {
        if (isCurrentRun(batchId, controller)) updateBatch(batchId, () => next);
      }, controller.signal);
      if (!isCurrentRun(batchId, controller)) return;
      updateBatch(batchId, () => result);
      if (result.runPhase === "awaiting-anchor-approval") {
        showToast("主场景已生成，请确认后继续", "success");
      } else if (result.runPhase === "idle") {
        showToast("提示词已恢复，请确认后开始生图", "success");
      } else {
        const completed = result.images.filter(image => image.status === "completed").length;
        showToast(`已继续完成 ${completed}/${result.images.length} 张`, result.runPhase === "failed" ? "error" : "success");
      }
    } catch (error) {
      if (controller.signal.aborted || isGenerationAbort(error)) return;
      if (!isCurrentRun(batchId, controller)) return;
      showToast(error instanceof Error ? error.message : "继续生成失败", "error");
    } finally {
      finishRun(batchId, controller);
    }
  };

  const downloadBatch = async () => {
    if (!activeBatch) return;
    const completed = activeBatch.images.filter(job => job.resultUrl);
    if (!completed.length) return showToast("当前批次还没有可下载的图片", "error");
    const zip = new JSZip();
    for (let index = 0; index < completed.length; index += 1) {
      const job = completed[index];
      if (job.resultUrl?.startsWith("data:")) {
        zip.file(`${activeBatch.name}-${index + 1}.png`, job.resultUrl.split(",")[1], { base64: true });
      } else if (job.resultUrl) {
        const blob = await fetch(job.resultUrl).then(response => response.blob());
        zip.file(`${activeBatch.name}-${index + 1}.png`, blob);
      }
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeBatch.name}-图片.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!hydrated) {
    return <div className="app-shell" aria-busy="true" />;
  }

  if (batchLoadFailed) {
    return (
      <div className="app-shell workspace-load-state">
        <AlertTriangle size={30} />
        <h1>批次加载失败</h1>
        <p>无法读取本地保存的产品批次。为避免覆盖已有数据，工作区已停止编辑和保存。</p>
        <button className="primary-button" onClick={loadWorkspace}><RefreshCw size={16} />重试加载</button>
      </div>
    );
  }

  if (!isProductWorkspaceReady(hydrated, activeBatch)) {
    return <div className="app-shell" aria-busy="true" />;
  }

  const selectedPromptCount = activeBatch.prompts.filter(prompt => prompt.selected).length;
  const completedCount = activeBatch.images.filter(image => image.status === "completed").length;
  const plannedImageCount = getPlannedImageCount(activeBatch);
  const generationActive = runningBatchIds.has(activeBatch.id);
  const persistenceMessages = [
    batchPersistenceError ? "批次自动保存失败，请检查浏览器存储后再次编辑以重试。" : "",
    preferencePersistenceError ? "模板偏好保存失败，新批次可能无法继承本次修改。" : "",
    muzhiPreferencePersistenceError ? "Muzhi 并发偏好保存失败，请再次调整设置以重试。" : ""
  ].filter(Boolean);
  const hasPersistenceError = persistenceMessages.length > 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark"><Layers3 size={19} /></span>
          <div><strong>产品生图工作台</strong><span>Product Image Studio</span></div>
        </div>
        <div className="topbar-status">
          <span><i className={`status-dot${hasPersistenceError ? " error" : ""}`} />{hasPersistenceError ? "本地保存异常" : "本地自动保存"}</span>
          <span className="topbar-divider" />
          <span>{PROVIDER_LABELS[activeBatch.imageProvider]} · {activeBatch.imageModel}</span>
        </div>
        <button className="topbar-button" onClick={() => setSettingsOpen(true)}><KeyRound size={16} />API 连接</button>
      </header>

      {hasPersistenceError && <div className="persistence-alert" role="alert"><AlertTriangle size={16} />{persistenceMessages.join(" ")}</div>}

      <div className="studio-layout">
        <aside className="batch-rail">
          <div className="rail-heading"><span>产品批次</span><button className="icon-button" title="新建批次" onClick={createBatch}><Plus size={16} /></button></div>
          <div className="batch-list">
            {batches.map(batch => (
              <button key={batch.id} className={`batch-item ${batch.id === activeBatch.id ? "active" : ""}`} onClick={() => setActiveBatchId(batch.id)}>
                <span className="batch-thumb">{batch.productReferenceImage || batch.styleReferenceImage ? <img src={batch.productReferenceImage || batch.styleReferenceImage} alt="" /> : <Boxes size={18} />}</span>
                <span className="batch-copy"><span className="batch-name-line"><strong>{batch.name || "未命名产品"}</strong><BatchStatusBadge status={getBatchDisplayStatus(batch)} /></span><small>{batch.prompts.length} 条提示词 · {batch.images.filter(item => item.status === "completed").length} 张完成</small></span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
          <button className="new-batch-button" onClick={createBatch}><Plus size={16} />新建产品批次</button>
          <button className="delete-batch-button" onClick={() => deleteBatch(activeBatch.id)}><Trash2 size={14} />删除当前批次</button>
        </aside>

        <main className="main-workspace">
          <nav className="stage-nav">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const disabled = stage.id === "review" ? activeBatch.prompts.length === 0 : stage.id === "results" ? activeBatch.images.length === 0 : false;
              return (
                <button
                  key={stage.id}
                  className={activeBatch.stage === stage.id ? "active" : ""}
                  disabled={disabled}
                  onClick={() => patchActiveBatch({ stage: stage.id })}
                >
                  <span>{index + 1}</span><Icon size={15} />{stage.label}
                </button>
              );
            })}
          </nav>

          {activeBatch.stage === "setup" && (
            <ProductSetup
              batch={activeBatch}
              loading={generationActive}
              onPatch={patchActiveBatch}
              onStyleImageSelected={async file => {
                try {
                  const styleReferenceImage = await imageFileToDataUrl(file);
                  patchActiveBatch({ styleReferenceImage });
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "风格图处理失败", "error");
                }
              }}
              onProductImageSelected={async file => {
                try {
                  const productReferenceImage = await imageFileToDataUrl(file);
                  updateBatch(activeBatch.id, batch => applyProductReferenceFilename({ ...batch, productReferenceImage }, file.name));
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "产品图处理失败", "error");
                }
              }}
              onPromptTemplateChange={updatePromptTemplate}
              onGenerate={handleSetupStart}
            />
          )}

          {activeBatch.stage === "review" && (
            <PromptReview
              prompts={activeBatch.prompts}
              busyPromptId={busyPromptId}
              appending={appending}
              onChange={(id, prompt) => updateBatch(activeBatch.id, batch => ({ ...batch, prompts: batch.prompts.map(item => item.id === id ? { ...item, prompt, updatedAt: Date.now() } : item) }))}
              onToggle={id => updateBatch(activeBatch.id, batch => ({ ...batch, prompts: batch.prompts.map(item => item.id === id ? { ...item, selected: !item.selected } : item) }))}
              onDelete={id => updateBatch(activeBatch.id, batch => ({ ...batch, prompts: batch.prompts.filter(item => item.id !== id) }))}
              onRegenerate={handleRegeneratePrompt}
              onSelectAll={selected => updateBatch(activeBatch.id, batch => ({ ...batch, prompts: batch.prompts.map(item => ({ ...item, selected })) }))}
              onAppend={handleAppendPrompts}
            />
          )}

          {activeBatch.stage === "results" && <ResultGallery images={activeBatch.images} onRetry={handleRetryJob} />}
        </main>

        <aside className="execution-panel">
          <div className="panel-title"><div><Settings2 size={16} /><strong>执行设置</strong></div><span>当前批次</span></div>

          <div className="setting-group">
            <label>提示词 AI</label>
            <div className="fixed-provider"><Sparkles size={15} /><span><strong>OpenRouter</strong><small>Qwen3.5 · 9B · 视觉模型</small></span></div>
            <div className="model-line"><span>{activeBatch.promptModel}</span></div>
          </div>

          <div className="setting-group">
            <label>生图服务</label>
            <div className="segment-control three">
              {(["yunwu", "apimart", "muzhi"] as ServiceProvider[]).map(provider => (
                <button key={provider} className={activeBatch.imageProvider === provider ? "active" : ""} onClick={() => patchActiveBatch({ imageProvider: provider, imageModel: IMAGE_MODELS[provider] })}>{PROVIDER_LABELS[provider]}</button>
              ))}
            </div>
            <div className="model-line"><ImageIcon size={13} /><span>{activeBatch.imageModel}</span></div>
          </div>

          <div className="setting-row">
            <label>画幅比例<select value={activeBatch.aspectRatio} onChange={event => patchActiveBatch({ aspectRatio: event.target.value })}>{ASPECT_RATIOS.map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>
            <label>分辨率<select value={activeBatch.imageSize} onChange={event => patchActiveBatch({ imageSize: event.target.value as ImageSize })}>{["1K", "2K", "4K"].map(size => <option key={size}>{size}</option>)}</select></label>
          </div>

          <div className="setting-group concurrency-setting">
            <label><span>并发数量</span><strong>{activeBatch.concurrency}</strong></label>
            <input type="range" min={1} max={3} value={activeBatch.concurrency} onChange={event => patchActiveBatch({ concurrency: Number(event.target.value) })} />
            <small>批量稳定优先，建议保持 1</small>
          </div>

          <div className="execution-summary">
            <div><span>风格参考图</span><strong>{activeBatch.styleReferenceImage ? "已绑定" : "未上传"}</strong></div>
            <div><span>产品参考图</span><strong>{activeBatch.productReferenceImage ? "已绑定" : "未上传"}</strong></div>
            <div><span>提示词</span><strong>{activeBatch.prompts.length} 条</strong></div>
            <div><span>本次生图</span><strong>{activeBatch.stage === "setup" ? plannedImageCount : selectedPromptCount} 张</strong></div>
            <div><span>已完成</span><strong>{completedCount} 张</strong></div>
          </div>

          <div className="panel-actions">
            {generationActive && <button className="panel-primary panel-danger" onClick={handleStopGeneration}><Square size={16} fill="currentColor" />停止生成</button>}
            {!generationActive && activeBatch.runPhase === "stopped" && <button className="panel-primary" onClick={handleResumeGeneration}><WandSparkles size={17} />继续剩余任务</button>}
            {!generationActive && activeBatch.runPhase !== "stopped" && activeBatch.stage === "setup" && <button className="panel-primary" disabled={activeBatch.workflowMode === "automatic" && (!activeBatch.styleReferenceImage || !activeBatch.productReferenceImage)} onClick={handleSetupStart}><Sparkles size={17} />{activeBatch.workflowMode === "automatic" ? `开始自动生成 ${plannedImageCount} 张` : activeBatch.promptStrategy === "anchored-angles" ? "生成主场景" : "生成提示词"}</button>}
            {!generationActive && activeBatch.runPhase !== "stopped" && activeBatch.stage === "review" && activeBatch.runPhase === "awaiting-anchor-approval" && <button className="panel-primary" onClick={handleContinueAnchor}><WandSparkles size={17} />确认主场景并继续</button>}
            {!generationActive && activeBatch.runPhase !== "stopped" && activeBatch.stage === "review" && activeBatch.runPhase !== "awaiting-anchor-approval" && <button className="panel-primary" disabled={selectedPromptCount === 0} onClick={handleGenerateImages}><WandSparkles size={17} />生成已选 {selectedPromptCount} 张</button>}
            {!generationActive && activeBatch.runPhase !== "stopped" && activeBatch.stage === "results" && activeBatch.runPhase === "awaiting-anchor-approval" && <button className="panel-primary" onClick={handleContinueAnchor}><WandSparkles size={17} />确认主场景并继续</button>}
            {!generationActive && activeBatch.stage === "results" && completedCount > 0 && <button className="panel-primary panel-secondary" onClick={downloadBatch}><Download size={17} />打包下载 {completedCount} 张</button>}
          </div>
        </aside>
      </div>

      <ProviderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => showToast("API 连接已保存", "success")} />
      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
};

export default App;
