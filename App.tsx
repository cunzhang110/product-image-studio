import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  Boxes,
  ChevronRight,
  Download,
  Image as ImageIcon,
  KeyRound,
  Layers3,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles
} from "lucide-react";
import { ProductSetup } from "./components/ProductSetup";
import { PromptReview } from "./components/PromptReview";
import { ProviderSettings } from "./components/ProviderSettings";
import { ResultGallery } from "./components/ResultGallery";
import {
  createImageJobs,
  createProductBatch,
  promptsToVariants,
  type ImageGeneration,
  type ProductBatch,
  type PromptProvider
} from "./domain/productWorkflow";
import { generateImage } from "./services/geminiService";
import { runProductImageJobs } from "./services/productImageQueue";
import { generateProductPrompts } from "./services/productPromptService";
import type { ImageSize, ServiceProvider } from "./types";
import { loadProductBatchesFromDB, saveProductBatchesToDB } from "./utils/db";

const PROMPT_MODELS: Record<PromptProvider, string> = {
  yunwu: "gemini-3-pro-preview",
  apimart: "gemini-2.5-pro"
};

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
  reader.onerror = () => reject(new Error("读取产品图失败"));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error("产品图格式无法识别"));
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
  const initialBatchRef = useRef(createProductBatch("我的产品批次"));
  const [batches, setBatches] = useState<ProductBatch[]>([initialBatchRef.current]);
  const [activeBatchId, setActiveBatchId] = useState(initialBatchRef.current.id);
  const [hydrated, setHydrated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [appending, setAppending] = useState(false);
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null);
  const [imageRunning, setImageRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);

  const activeBatch = useMemo(
    () => batches.find(batch => batch.id === activeBatchId) || batches[0],
    [batches, activeBatchId]
  );

  useEffect(() => {
    loadProductBatchesFromDB()
      .then(stored => {
        if (stored.length) {
          setBatches(stored);
          setActiveBatchId(stored[0].id);
        }
      })
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => saveProductBatchesToDB(batches), 250);
    return () => window.clearTimeout(timer);
  }, [batches, hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (message: string, tone: "success" | "error" | "info" = "info") => setToast({ message, tone });

  const updateBatch = (batchId: string, updater: (batch: ProductBatch) => ProductBatch) => {
    setBatches(current => current.map(batch => batch.id === batchId
      ? { ...updater(batch), updatedAt: Date.now() }
      : batch));
  };

  const patchActiveBatch = (patch: Partial<ProductBatch>) => {
    if (!activeBatch) return;
    updateBatch(activeBatch.id, batch => ({ ...batch, ...patch }));
  };

  const createBatch = () => {
    const next = createProductBatch(`产品批次 ${batches.length + 1}`);
    setBatches(current => [next, ...current]);
    setActiveBatchId(next.id);
  };

  const deleteBatch = (batchId: string) => {
    if (!window.confirm("确定删除当前产品批次吗？其中的提示词和生图结果也会一起删除。")) return;
    if (batches.length === 1) {
      const next = createProductBatch("我的产品批次");
      setBatches([next]);
      setActiveBatchId(next.id);
      return;
    }
    const remaining = batches.filter(batch => batch.id !== batchId);
    setBatches(remaining);
    if (activeBatchId === batchId) setActiveBatchId(remaining[0].id);
  };

  const validatePromptInput = (batch: ProductBatch) => {
    if (!batch.referenceImage) throw new Error("请先上传一张产品参考图");
    if (!batch.name.trim()) throw new Error("请填写产品或批次名称");
    if (!batch.promptTemplate.trim() && !batch.creativeGuide.trim()) {
      throw new Error("提示词模板和创作引导至少填写一项");
    }
  };

  const requestPrompts = async (batch: ProductBatch, count: number) => generateProductPrompts({
    provider: batch.promptProvider,
    model: batch.promptModel,
    productName: batch.name,
    referenceImage: batch.referenceImage,
    promptTemplate: batch.promptTemplate,
    creativeGuide: batch.creativeGuide,
    count
  });

  const handleGeneratePrompts = async () => {
    if (!activeBatch || promptLoading) return;
    try {
      validatePromptInput(activeBatch);
      setPromptLoading(true);
      const prompts = await requestPrompts(activeBatch, activeBatch.requestedPromptCount);
      updateBatch(activeBatch.id, batch => ({ ...batch, prompts: promptsToVariants(prompts), stage: "review" }));
      showToast(`已生成 ${prompts.length} 条提示词，确认后再开始生图`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "提示词生成失败";
      if (message.includes("API_KEY")) setSettingsOpen(true);
      showToast(message === "API_KEY_MISSING" ? "请先配置提示词 AI 的 API Key" : message, "error");
    } finally {
      setPromptLoading(false);
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
    setImageRunning(true);
    updateBatch(batch.id, current => ({ ...current, images: jobs, stage: "results" }));
    const completed = await runProductImageJobs(
      jobs,
      batch.concurrency,
      async job => {
        const reference = {
          id: "product-reference",
          name: "产品参考图",
          imageData: job.referenceImageSnapshot
        };
        return generateImage(
          job.promptSnapshot,
          job.aspectRatio,
          job.imageSize,
          job.provider,
          [reference],
          job.model,
          `@{产品参考图} ${job.promptSnapshot}`
        );
      },
      nextJobs => updateBatch(batch.id, current => ({ ...current, images: nextJobs, stage: "results" }))
    );
    updateBatch(batch.id, current => ({ ...current, images: completed, stage: "results" }));
    setImageRunning(false);
    const successCount = completed.filter(job => job.status === "completed").length;
    showToast(`本批次完成 ${successCount}/${completed.length} 张`, successCount ? "success" : "error");
  };

  const handleGenerateImages = async () => {
    if (!activeBatch || imageRunning) return;
    if (!activeBatch.referenceImage) return showToast("产品参考图已缺失，请重新上传", "error");
    const jobs = createImageJobs(activeBatch);
    if (!jobs.length) return showToast("请先选择至少一条提示词", "error");
    await runJobs(activeBatch, jobs);
  };

  const handleRetryJob = async (job: ImageGeneration) => {
    if (!activeBatch || imageRunning) return;
    const retryJob = { ...job, status: "idle" as const, error: undefined, resultUrl: undefined };
    const otherJobs = activeBatch.images.filter(item => item.id !== job.id);
    updateBatch(activeBatch.id, batch => ({ ...batch, images: [...otherJobs, retryJob] }));
    const result = await runProductImageJobs([retryJob], 1, async current => {
      const reference = { id: "product-reference", name: "产品参考图", imageData: current.referenceImageSnapshot };
      return generateImage(current.promptSnapshot, current.aspectRatio, current.imageSize, current.provider, [reference], current.model, `@{产品参考图} ${current.promptSnapshot}`);
    });
    updateBatch(activeBatch.id, batch => ({
      ...batch,
      images: batch.images.map(item => item.id === job.id ? result[0] : item)
    }));
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

  if (!activeBatch) return null;

  const selectedPromptCount = activeBatch.prompts.filter(prompt => prompt.selected).length;
  const completedCount = activeBatch.images.filter(image => image.status === "completed").length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark"><Layers3 size={19} /></span>
          <div><strong>产品生图工作台</strong><span>Product Image Studio</span></div>
        </div>
        <div className="topbar-status">
          <span><i className="status-dot" />本地自动保存</span>
          <span className="topbar-divider" />
          <span>{PROVIDER_LABELS[activeBatch.imageProvider]} · {activeBatch.imageModel}</span>
        </div>
        <button className="topbar-button" onClick={() => setSettingsOpen(true)}><KeyRound size={16} />API 连接</button>
      </header>

      <div className="studio-layout">
        <aside className="batch-rail">
          <div className="rail-heading"><span>产品批次</span><button className="icon-button" title="新建批次" onClick={createBatch}><Plus size={16} /></button></div>
          <div className="batch-list">
            {batches.map(batch => (
              <button key={batch.id} className={`batch-item ${batch.id === activeBatch.id ? "active" : ""}`} onClick={() => setActiveBatchId(batch.id)}>
                <span className="batch-thumb">{batch.referenceImage ? <img src={batch.referenceImage} alt="" /> : <Boxes size={18} />}</span>
                <span className="batch-copy"><strong>{batch.name || "未命名产品"}</strong><small>{batch.prompts.length} 条提示词 · {batch.images.filter(item => item.status === "completed").length} 张完成</small></span>
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
              loading={promptLoading}
              onPatch={patchActiveBatch}
              onImageSelected={async file => {
                try {
                  const referenceImage = await imageFileToDataUrl(file);
                  patchActiveBatch({ referenceImage });
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "产品图处理失败", "error");
                }
              }}
              onGenerate={handleGeneratePrompts}
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
            <div className="segment-control two">
              {(["yunwu", "apimart"] as PromptProvider[]).map(provider => (
                <button key={provider} className={activeBatch.promptProvider === provider ? "active" : ""} onClick={() => patchActiveBatch({ promptProvider: provider, promptModel: PROMPT_MODELS[provider] })}>{PROVIDER_LABELS[provider]}</button>
              ))}
            </div>
            <div className="model-line"><Sparkles size={13} /><span>{activeBatch.promptModel}</span></div>
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
            <div><span>产品参考图</span><strong>{activeBatch.referenceImage ? "已绑定" : "未上传"}</strong></div>
            <div><span>提示词</span><strong>{activeBatch.prompts.length} 条</strong></div>
            <div><span>本次生图</span><strong>{selectedPromptCount} 张</strong></div>
            <div><span>已完成</span><strong>{completedCount} 张</strong></div>
          </div>

          {activeBatch.stage === "setup" && <button className="panel-primary" disabled={promptLoading} onClick={handleGeneratePrompts}><Sparkles size={17} />{promptLoading ? "正在生成" : "生成提示词"}</button>}
          {activeBatch.stage === "review" && <button className="panel-primary" disabled={imageRunning || selectedPromptCount === 0} onClick={handleGenerateImages}><WandSparkles size={17} />{imageRunning ? "正在批量生图" : `生成已选 ${selectedPromptCount} 张`}</button>}
          {activeBatch.stage === "results" && <button className="panel-primary" onClick={downloadBatch}><Download size={17} />打包下载 {completedCount} 张</button>}
        </aside>
      </div>

      <ProviderSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => showToast("API 连接已保存", "success")} />
      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
};

export default App;
