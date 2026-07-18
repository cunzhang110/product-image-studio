import React from "react";
import { ArrowDown, ArrowUp, Copy, GitBranch, Plus, RotateCcw, Trash2 } from "lucide-react";
import { createDefaultWineExtensionNodes, type ExtensionNodeType, type SceneExtensionNode } from "../domain/productWorkflow";

interface SceneExtensionEditorProps {
  nodes: SceneExtensionNode[];
  disabled?: boolean;
  onChange: (nodes: SceneExtensionNode[]) => void;
}

const NODE_TYPE_LABELS: Record<ExtensionNodeType, string> = {
  camera: "机位变化",
  action: "产品动作",
  "camera-action": "机位 + 动作"
};

const createNodeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const SceneExtensionEditor: React.FC<SceneExtensionEditorProps> = ({ nodes, disabled = false, onChange }) => {
  const patchNode = (id: string, patch: Partial<SceneExtensionNode>) => {
    onChange(nodes.map(node => node.id === id ? { ...node, ...patch } : node));
  };

  const moveNode = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return;
    const next = [...nodes];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <section className="scene-map-editor" aria-label="自定义思维导图">
      <div className="scene-map-heading">
        <div><GitBranch size={17} /><span><strong>自定义延伸方向</strong><small>每个节点对应一张成品图</small></span></div>
        <strong>预计生成 {nodes.length + 1} 张</strong>
      </div>

      <div className="scene-map-root">
        <span>主图</span>
        <div><strong>主场景图</strong><small>锁定环境、产品、道具、光线和整体调性</small></div>
      </div>

      <div className="scene-node-list">
        {nodes.map((node, index) => (
          <div className={`scene-node ${node.instruction.trim() ? "" : "invalid"}`} key={node.id}>
            <span className="scene-node-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="scene-node-fields">
              <select
                aria-label={`节点 ${index + 1} 类型`}
                disabled={disabled}
                value={node.type}
                onChange={event => patchNode(node.id, { type: event.target.value as ExtensionNodeType })}
              >
                {(Object.keys(NODE_TYPE_LABELS) as ExtensionNodeType[]).map(type => (
                  <option key={type} value={type}>{NODE_TYPE_LABELS[type]}</option>
                ))}
              </select>
              <textarea
                aria-label={`节点 ${index + 1} 延伸指令`}
                disabled={disabled}
                value={node.instruction}
                onChange={event => patchNode(node.id, { instruction: event.target.value })}
                placeholder="填写这一张需要变化的机位、动作或状态"
              />
            </div>
            <div className="scene-node-actions">
              <button className="icon-button" disabled={disabled || index === 0} title="上移" onClick={() => moveNode(index, -1)}><ArrowUp size={14} /></button>
              <button className="icon-button" disabled={disabled || index === nodes.length - 1} title="下移" onClick={() => moveNode(index, 1)}><ArrowDown size={14} /></button>
              <button className="icon-button" disabled={disabled} title="复制节点" onClick={() => onChange([...nodes.slice(0, index + 1), { ...node, id: createNodeId() }, ...nodes.slice(index + 1)])}><Copy size={14} /></button>
              <button className="icon-button danger" disabled={disabled} title="删除节点" onClick={() => onChange(nodes.filter(item => item.id !== node.id))}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="scene-map-commands">
        <button className="secondary-button" disabled={disabled} onClick={() => onChange([...nodes, { id: createNodeId(), type: "camera", instruction: "" }])}><Plus size={15} />添加延伸节点</button>
        <button className="secondary-button" disabled={disabled} onClick={() => onChange(createDefaultWineExtensionNodes())}><RotateCcw size={15} />恢复酒瓶模板</button>
      </div>
      <p>预计生成 {nodes.length + 1} 张（主图 1 张 + 分支 {nodes.length} 张）</p>
    </section>
  );
};
