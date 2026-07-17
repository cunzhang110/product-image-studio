import React from "react";
import { CheckCheck, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import type { PromptVariant } from "../domain/productWorkflow";

interface PromptReviewProps {
  prompts: PromptVariant[];
  busyPromptId: string | null;
  appending: boolean;
  onChange: (id: string, prompt: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRegenerate: (id: string) => void;
  onSelectAll: (selected: boolean) => void;
  onAppend: () => void;
}

export const PromptReview: React.FC<PromptReviewProps> = ({
  prompts,
  busyPromptId,
  appending,
  onChange,
  onToggle,
  onDelete,
  onRegenerate,
  onSelectAll,
  onAppend
}) => {
  const selectedCount = prompts.filter(item => item.selected).length;

  return (
    <section className="workspace-section review-section">
      <div className="section-heading review-heading">
        <div>
          <span className="step-kicker">02 / 提示词审核</span>
          <h2>确认后再产生图片费用</h2>
          <p>每条提示词都继承同一张产品参考图。可直接改字，不会改变其他任务。</p>
        </div>
        <div className="review-count"><strong>{selectedCount}</strong><span>已选 / {prompts.length}</span></div>
      </div>

      <div className="review-toolbar">
        <button className="secondary-button" onClick={() => onSelectAll(true)}><CheckCheck size={15} />全选</button>
        <button className="secondary-button" onClick={() => onSelectAll(false)}><X size={15} />取消选择</button>
        <span className="toolbar-separator" />
        <button className="secondary-button" onClick={onAppend} disabled={appending}>
          {appending ? <RefreshCw size={15} className="spin" /> : <Plus size={15} />}
          追加提示词
        </button>
      </div>

      {prompts.length === 0 ? (
        <div className="empty-state">
          <Sparkles size={26} />
          <strong>还没有提示词</strong>
          <span>返回产品设置，上传参考图并生成第一批提示词。</span>
        </div>
      ) : (
        <div className="prompt-list">
          {prompts.map((item, index) => (
            <article className={`prompt-row ${item.selected ? "selected" : ""}`} key={item.id}>
              <button className={`prompt-check ${item.selected ? "active" : ""}`} onClick={() => onToggle(item.id)} aria-label={item.selected ? "取消选择" : "选择提示词"}>
                {item.selected && <CheckCheck size={15} />}
              </button>
              <span className="prompt-index">{String(index + 1).padStart(2, "0")}</span>
              <textarea value={item.prompt} onChange={event => onChange(item.id, event.target.value)} />
              <div className="prompt-actions">
                <button className="icon-button" title="重新生成这条" onClick={() => onRegenerate(item.id)} disabled={busyPromptId === item.id}>
                  <RefreshCw size={15} className={busyPromptId === item.id ? "spin" : ""} />
                </button>
                <button className="icon-button danger" title="删除" onClick={() => onDelete(item.id)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
