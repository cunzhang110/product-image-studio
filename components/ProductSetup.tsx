import React, { useRef } from "react";
import { ImagePlus, Sparkles, Upload, X } from "lucide-react";
import type { ProductBatch } from "../domain/productWorkflow";

interface ProductSetupProps {
  batch: ProductBatch;
  loading: boolean;
  onPatch: (patch: Partial<ProductBatch>) => void;
  onImageSelected: (file: File) => void;
  onGenerate: () => void;
}

export const ProductSetup: React.FC<ProductSetupProps> = ({ batch, loading, onPatch, onImageSelected, onGenerate }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <section className="workspace-section setup-section">
      <div className="section-heading">
        <div>
          <span className="step-kicker">01 / 产品设置</span>
          <h2>锁定这批图片的产品</h2>
          <p>参考图只上传一次，同时交给提示词 AI 和最终生图模型。</p>
        </div>
        <button className="primary-button desktop-primary" onClick={onGenerate} disabled={loading}>
          <Sparkles size={17} />
          {loading ? "正在生成提示词" : `生成 ${batch.requestedPromptCount} 条提示词`}
        </button>
      </div>

      <div className="setup-grid">
        <div className="product-reference-column">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) onImageSelected(file);
              event.target.value = "";
            }}
          />
          {batch.referenceImage ? (
            <div className="product-preview">
              <img src={batch.referenceImage} alt={batch.name || "产品参考图"} />
              <div className="product-preview-actions">
                <button className="icon-button light" title="更换产品图" onClick={() => fileRef.current?.click()}>
                  <Upload size={16} />
                </button>
                <button className="icon-button danger-light" title="移除产品图" onClick={() => onPatch({ referenceImage: "" })}>
                  <X size={16} />
                </button>
              </div>
            </div>
          ) : (
            <button className="product-dropzone" onClick={() => fileRef.current?.click()}>
              <span className="upload-mark"><ImagePlus size={28} /></span>
              <strong>上传产品参考图</strong>
              <small>建议主体清晰、包装文字完整、背景简单</small>
            </button>
          )}
          <div className="reference-note">
            <span className="status-dot" />
            单张产品图将自动绑定到本批次全部任务
          </div>
        </div>

        <div className="setup-fields">
          <label className="field-group compact-field">
            <span>产品 / 批次名称</span>
            <input
              value={batch.name}
              onChange={event => onPatch({ name: event.target.value })}
              placeholder="例如：青柠气泡水夏季场景"
            />
          </label>

          <label className="field-group">
            <span>提示词模板</span>
            <textarea
              value={batch.promptTemplate}
              onChange={event => onPatch({ promptTemplate: event.target.value })}
              placeholder="写入每条提示词都必须保留的内容，例如产品包装、品牌文字、画面用途、禁止改变的部分……"
            />
            <small>模板负责固定产品和表达框架，AI 不会把它当成单独一条提示词。</small>
          </label>

          <label className="field-group">
            <span>创作引导</span>
            <textarea
              value={batch.creativeGuide}
              onChange={event => onPatch({ creativeGuide: event.target.value })}
              placeholder="例如：生活化真实摄影，分别安排桌面静物、人物手持、户外野餐与便利店场景，变化镜头和光线……"
            />
            <small>这里决定这一批提示词如何变化场景、构图和人物互动。</small>
          </label>

          <label className="field-group count-field">
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
          </label>
        </div>
      </div>

      <button className="primary-button mobile-primary" onClick={onGenerate} disabled={loading}>
        <Sparkles size={17} />
        {loading ? "正在生成提示词" : `生成 ${batch.requestedPromptCount} 条提示词`}
      </button>
    </section>
  );
};
