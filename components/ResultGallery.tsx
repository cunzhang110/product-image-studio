import React, { useState } from "react";
import { Download, Image, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import type { ImageGeneration } from "../domain/productWorkflow";
import { preferredImageUrl } from "../services/photoFinishService";

interface ResultGalleryProps {
  images: ImageGeneration[];
  onRetry: (job: ImageGeneration) => void;
  onRefinish: (job: ImageGeneration) => void;
}

export const ResultGallery: React.FC<ResultGalleryProps> = ({ images, onRetry, onRefinish }) => {
  const [showOriginal, setShowOriginal] = useState<Record<string, boolean>>({});
  return (
  <section className="workspace-section results-section">
    <div className="section-heading">
      <div>
        <span className="step-kicker">03 / 生图结果</span>
        <h2>同一产品的整批结果</h2>
        <p>结果保留生成时的提示词和参考图快照，失败任务可以单独重试。</p>
      </div>
    </div>

    {images.length === 0 ? (
      <div className="empty-state"><Image size={28} /><strong>还没有生图任务</strong><span>在提示词审核中选择内容后开始批量生图。</span></div>
    ) : (
      <div className="result-grid">
        {images.map((job, index) => (
          <article className="result-item" key={job.id}>
            <div className="result-media">
              {job.resultUrl ? (
                <img src={showOriginal[job.id] ? job.resultUrl : preferredImageUrl(job)} alt={job.promptSnapshot} />
              ) : job.status === "failed" ? (
                <div className="result-placeholder failed"><TriangleAlert size={24} /><span>{job.error || "生成失败"}</span></div>
              ) : (
                <div className="result-placeholder"><LoaderCircle size={24} className={job.status !== "idle" ? "spin" : ""} /><span>{job.status === "queued" ? "排队中" : job.status === "generating" ? "正在生成" : "等待开始"}</span></div>
              )}
              <span className="result-number">{String(index + 1).padStart(2, "0")}</span>
            </div>
            <p>{job.promptSnapshot}</p>
            <div className="result-footer">
              <span className={`job-status ${job.status}`}>{job.status === "completed" ? "已完成" : job.status === "failed" ? "失败" : job.status === "generating" ? "生成中" : "排队"}</span>
              <div>
                {job.status === "failed" && <button className="icon-button" title="重试" onClick={() => onRetry(job)}><RefreshCw size={15} /></button>}
                {job.finishedResultUrl && <button className="icon-button" title={showOriginal[job.id] ? "查看实拍优化" : "查看原图"} onClick={() => setShowOriginal(current => ({ ...current, [job.id]: !current[job.id] }))}><Image size={15} /></button>}
                {job.resultUrl && <button className="icon-button" title="重新优化" onClick={() => onRefinish(job)}><Sparkles size={15} /></button>}
                {job.resultUrl && <button className="icon-button" title="下载" onClick={() => {
                  const link = document.createElement("a");
                  link.href = preferredImageUrl(job)!;
                  link.download = `product-${index + 1}.png`;
                  link.click();
                }}><Download size={15} /></button>}
              </div>
            </div>
          </article>
        ))}
      </div>
    )}
  </section>
  );
};
