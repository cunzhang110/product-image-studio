import React, { useRef } from "react";
import { ImagePlus, PackageCheck, Palette, Sparkles, Upload, X } from "lucide-react";
import { createDefaultWineExtensionNodes, getPlannedImageCount, type ProductBatch } from "../domain/productWorkflow";
import { SceneExtensionEditor } from "./SceneExtensionEditor";

interface ProductSetupProps {
  batch: ProductBatch;
  loading: boolean;
  onPatch: (patch: Partial<ProductBatch>) => void;
  onStyleImageSelected: (file: File) => void;
  onProductImageSelected: (file: File) => void;
  onGenerate: () => void;
}

interface ReferenceUploadProps {
  kind: "style" | "product";
  image: string;
  title: string;
  note: string;
  onSelect: (file: File) => void;
  onClear: () => void;
}

const ReferenceUpload: React.FC<ReferenceUploadProps> = ({ kind, image, title, note, onSelect, onClear }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const Icon = kind === "product" ? PackageCheck : Palette;
  return (
    <div className={`reference-card ${kind}`}>
      <div className="reference-label">
        <Icon size={16} />
        <span><strong>{title}</strong><small>{kind === "product" ? "主体最高优先级" : "用于生成提示词"}</small></span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = "";
        }}
      />
      {image ? (
        <div className="reference-preview">
          <img src={image} alt={title} />
          <div className="product-preview-actions">
            <button className="icon-button light" title={`更换${title}`} onClick={() => fileRef.current?.click()}><Upload size={16} /></button>
            <button className="icon-button danger-light" title={`移除${title}`} onClick={onClear}><X size={16} /></button>
          </div>
        </div>
      ) : (
        <button className="reference-dropzone" onClick={() => fileRef.current?.click()}>
          <span className="upload-mark"><ImagePlus size={25} /></span>
          <strong>上传{title}</strong>
          <small>{note}</small>
        </button>
      )}
    </div>
  );
};

export const ProductSetup: React.FC<ProductSetupProps> = ({
  batch,
  loading,
  onPatch,
  onStyleImageSelected,
  onProductImageSelected,
  onGenerate
}) => {
  const customMap = batch.promptStrategy === "anchored-angles" && batch.sameSceneBranchMode === "custom-map";
  const plannedCount = getPlannedImageCount(batch);
  const actionLabel = loading
    ? "正在处理"
    : batch.workflowMode === "automatic"
      ? `开始自动生成 ${plannedCount} 张`
      : batch.promptStrategy === "anchored-angles" ? "生成主场景" : `生成 ${plannedCount} 条提示词`;
  const useCustomMap = () => onPatch({
    sameSceneBranchMode: "custom-map",
    extensionNodes: batch.extensionNodes.length ? batch.extensionNodes : createDefaultWineExtensionNodes()
  });

  return (
  <section className="workspace-section setup-section">
    <div className="section-heading">
      <div>
        <span className="step-kicker">01 / 双参考设置</span>
        <h2>先定风格，再锁定产品</h2>
        <p>风格图决定提示词的画面调性；产品图在最终生图时拥有最高优先级。</p>
      </div>
      <button className="primary-button desktop-primary" onClick={onGenerate} disabled={loading || (batch.workflowMode === "automatic" && (!batch.styleReferenceImage || !batch.productReferenceImage))}>
        <Sparkles size={17} />
        {actionLabel}
      </button>
    </div>

    <div className="setup-grid">
      <div className="product-reference-column">
        <div className="reference-pair">
          <ReferenceUpload
            kind="style"
            image={batch.styleReferenceImage}
            title="风格参考图"
            note="参考构图、光线、色彩和整体调性"
            onSelect={onStyleImageSelected}
            onClear={() => onPatch({ styleReferenceImage: "" })}
          />
          <ReferenceUpload
            kind="product"
            image={batch.productReferenceImage}
            title="产品参考图"
            note="主体清晰，包装、Logo 和文字完整"
            onSelect={onProductImageSelected}
            onClear={() => onPatch({ productReferenceImage: "" })}
          />
        </div>
        <div className="reference-note"><span className="status-dot" />产品图约束主体，风格图不得改变产品外观</div>
      </div>

      <div className="setup-fields">
        <div className="mode-grid">
          <div className="field-group"><span>操作模式</span><div className="segment-control two">
            <button className={batch.workflowMode === "manual" ? "active" : ""} onClick={() => onPatch({ workflowMode: "manual" })}>手动</button>
            <button className={batch.workflowMode === "automatic" ? "active" : ""} onClick={() => onPatch({ workflowMode: "automatic" })}>自动</button>
          </div></div>
          <div className="field-group"><span>生成方式</span><div className="segment-control two">
            <button className={batch.promptStrategy === "varied-scenes" ? "active" : ""} onClick={() => onPatch({ promptStrategy: "varied-scenes" })}>多场景创意</button>
            <button className={batch.promptStrategy === "anchored-angles" ? "active" : ""} onClick={() => onPatch({ promptStrategy: "anchored-angles" })}>同场景多机位</button>
          </div></div>
        </div>

        {batch.promptStrategy === "anchored-angles" && <div className="field-group branch-mode-field">
          <span>同场景延伸方式</span>
          <div className="segment-control two">
            <button className={batch.sameSceneBranchMode === "ai-random" ? "active" : ""} onClick={() => onPatch({ sameSceneBranchMode: "ai-random" })}>AI 随机延伸</button>
            <button className={batch.sameSceneBranchMode === "custom-map" ? "active" : ""} onClick={useCustomMap}>自定义思维导图</button>
          </div>
          <small>{batch.sameSceneBranchMode === "ai-random" ? "AI 根据主场景自动规划不同机位。" : "每个节点控制一张分支图，可指定机位、产品动作或两者同时变化。"}</small>
        </div>}

        <label className="field-group compact-field">
          <span>产品 / 批次名称</span>
          <input value={batch.name} onChange={event => onPatch({ name: event.target.value, nameSource: "manual" })} placeholder="例如：青柠气泡水夏季场景" />
        </label>

        <label className="field-group">
          <span>提示词模板</span>
          <textarea
            value={batch.promptTemplate}
            onChange={event => onPatch({ promptTemplate: event.target.value })}
            placeholder="写入每条提示词都必须保留的内容，例如画面用途、主体位置、禁止改变的部分……"
          />
          <small>模板负责固定表达框架；具体产品外观由产品参考图约束。</small>
        </label>

        <label className="field-group">
          <span>创作引导</span>
          <textarea
            value={batch.creativeGuide}
            onChange={event => onPatch({ creativeGuide: event.target.value })}
            placeholder="例如：从风格图提取真实摄影调性，分别变化场景、构图、人物互动和镜头……"
          />
          <small>Qwen 会结合风格参考图，将这里的要求扩展为一批提示词。</small>
        </label>

        {customMap && <SceneExtensionEditor
          nodes={batch.extensionNodes}
          disabled={loading}
          onChange={extensionNodes => onPatch({ extensionNodes })}
        />}

        {!customMap && <label className="field-group count-field">
          <span>提示词数量</span>
          <div className="count-control">
            <button onClick={() => onPatch({ requestedPromptCount: Math.max(1, batch.requestedPromptCount - 1) })}>−</button>
            <input
              type="number"
              min={1}
              max={50}
              value={batch.requestedPromptCount}
              onChange={event => onPatch({ requestedPromptCount: Math.min(50, Math.max(1, Number(event.target.value) || 1)) })}
            />
            <button onClick={() => onPatch({ requestedPromptCount: Math.min(50, batch.requestedPromptCount + 1) })}>+</button>
          </div>
        </label>}
      </div>
    </div>

    <button className="primary-button mobile-primary" onClick={onGenerate} disabled={loading || (batch.workflowMode === "automatic" && (!batch.styleReferenceImage || !batch.productReferenceImage))}>
      <Sparkles size={17} />
      {actionLabel}
    </button>
  </section>
  );
};
