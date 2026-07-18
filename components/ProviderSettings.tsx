import React, { useState } from "react";
import { Eye, EyeOff, KeyRound, X } from "lucide-react";
import type { ServiceProvider } from "../types";
import { getStoredApiKey, saveStoredApiKey } from "../utils/apiKeyStorage";

interface ProviderSettingsProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const providers: Array<{ id: ServiceProvider; label: string; note: string }> = [
  { id: "yunwu", label: "云雾 API", note: "香蕉生图模型" },
  { id: "apimart", label: "APIMart", note: "GPT Image 2 生图模型" },
  { id: "muzhi", label: "Muzhi", note: "GPT Image 2，生产密钥由服务器管理" }
];

export const ProviderSettings: React.FC<ProviderSettingsProps> = ({ open, onClose, onSaved }) => {
  const [values, setValues] = useState<Record<ServiceProvider, string>>(() => ({
    yunwu: getStoredApiKey("yunwu"),
    apimart: getStoredApiKey("apimart"),
    muzhi: getStoredApiKey("muzhi")
  }));
  const [visible, setVisible] = useState<Record<ServiceProvider, boolean>>({ yunwu: false, apimart: false, muzhi: false });

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className="settings-modal">
        <div className="modal-heading">
          <div><KeyRound size={19} /><div><strong>服务商连接</strong><span>密钥只保存在当前浏览器</span></div></div>
          <button className="icon-button" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="provider-key-list">
          <div className="provider-key-row">
            <span><strong>OpenRouter</strong><small>Gemma 4 31B 提示词模型，密钥由服务器管理</small></span>
            <div className="server-key-state"><span className="status-dot" />服务器已配置</div>
          </div>
          {providers.map(provider => (
            <label key={provider.id} className="provider-key-row">
              <span><strong>{provider.label}</strong><small>{provider.note}</small></span>
              {provider.id === "muzhi" ? (
                <div className="server-key-state"><span className="status-dot" />服务器已配置</div>
              ) : (
                <div className="key-input-wrap">
                  <input
                    type={visible[provider.id] ? "text" : "password"}
                    value={values[provider.id]}
                    onChange={event => setValues(current => ({ ...current, [provider.id]: event.target.value }))}
                    placeholder="sk-..."
                  />
                  <button type="button" onClick={() => setVisible(current => ({ ...current, [provider.id]: !current[provider.id] }))}>
                    {visible[provider.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              )}
            </label>
          ))}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button className="primary-button" onClick={() => {
            saveStoredApiKey("yunwu", values.yunwu);
            saveStoredApiKey("apimart", values.apimart);
            onSaved();
            onClose();
          }}>保存连接</button>
        </div>
      </div>
    </div>
  );
};
