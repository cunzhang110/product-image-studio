# Setup Mode And Template Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立展示手动/自动模式，让产品图上传或拖入时自动命名批次，并让新批次继承最近一次编辑的提示词模板。

**Architecture:** 默认酒瓶模板由领域层提供，`createProductBatch` 接受可选模板偏好且不修改旧批次迁移。全局模板偏好存入现有 IndexedDB `settings` store，App 初始化时加载，并仅在创建新批次时注入。设置页使用独立操作模式区，参考图组件统一处理点击上传与拖放。

**Tech Stack:** React 19、TypeScript、IndexedDB、Vitest、Vite、Vercel

## Global Constraints

- 内置默认模板必须逐字保留：`保留酒瓶产品，并确保酒瓶完整清晰地出现在画面中。酒瓶不能缺失、细节清楚。场景替换为【XXX】。使用 iPhone 后置镜头拍摄，符合现实世界逻辑，呈现自然、透亮、生活化的日常快照质感，风格简约、松弛、真实。`
- 创作引导默认值必须为空字符串。
- 用户修改的模板只影响之后新建的批次，不覆盖已有批次。
- 空字符串是有效的已保存模板偏好。
- 用户手动改名后，更换产品参考图不得覆盖批次名称。
- 不增加新的运行时依赖。

---

### Task 1: 默认模板与批次创建

**Files:**
- Modify: `domain/productWorkflow.ts`
- Test: `domain/productWorkflow.test.ts`

**Interfaces:**
- Produces: `DEFAULT_PRODUCT_PROMPT_TEMPLATE: string`
- Produces: `createProductBatch(name?: string, promptTemplate?: string): ProductBatch`

- [ ] **Step 1: 写失败测试**

```ts
it("uses the wine template for new batches and accepts an explicit preference", () => {
  expect(createProductBatch().promptTemplate).toBe(DEFAULT_PRODUCT_PROMPT_TEMPLATE);
  expect(createProductBatch("产品", "用户模板").promptTemplate).toBe("用户模板");
  expect(createProductBatch("产品", "").promptTemplate).toBe("");
  expect(createProductBatch().creativeGuide).toBe("");
});
```

- [ ] **Step 2: 运行测试并确认因默认模板缺失而失败**

Run: `npx vitest run domain/productWorkflow.test.ts`

Expected: FAIL，`promptTemplate` 当前为 `""` 或导出常量不存在。

- [ ] **Step 3: 实现最小领域逻辑**

```ts
export const DEFAULT_PRODUCT_PROMPT_TEMPLATE = "保留酒瓶产品，并确保酒瓶完整清晰地出现在画面中。酒瓶不能缺失、细节清楚。场景替换为【XXX】。使用 iPhone 后置镜头拍摄，符合现实世界逻辑，呈现自然、透亮、生活化的日常快照质感，风格简约、松弛、真实。";

export const createProductBatch = (
  name = "未命名产品",
  promptTemplate = DEFAULT_PRODUCT_PROMPT_TEMPLATE
): ProductBatch => {
  const now = Date.now();
  return {
    // 保留当前返回对象中的全部字段，仅将原来的 promptTemplate: "" 改为：
    promptTemplate,
    // creativeGuide 继续保持：
    creativeGuide: ""
  } as ProductBatch;
};
```

实现动作是对现有 `createProductBatch` 做两处精确替换：增加第二个默认参数，并把返回对象中的 `promptTemplate: ""` 改为 `promptTemplate`；其他返回字段逐行保持原样。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run domain/productWorkflow.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add domain/productWorkflow.ts domain/productWorkflow.test.ts
git commit -m "feat: add default product prompt template"
```

### Task 2: 模板偏好持久化与新批次继承

**Files:**
- Modify: `utils/db.ts`
- Test: `utils/db.test.ts`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `DEFAULT_PRODUCT_PROMPT_TEMPLATE`
- Produces: `savePromptTemplatePreference(promptTemplate: string): Promise<void>`
- Produces: `loadPromptTemplatePreference(): Promise<string | null>`，不存在返回 `null`，已保存空模板返回 `""`

- [ ] **Step 1: 写 IndexedDB 失败测试**

```ts
it("distinguishes a missing template preference from a saved empty template", async () => {
  expect(await loadPromptTemplatePreference()).toBeNull();
  await savePromptTemplatePreference("");
  expect(await loadPromptTemplatePreference()).toBe("");
  await savePromptTemplatePreference("新的酒瓶模板");
  expect(await loadPromptTemplatePreference()).toBe("新的酒瓶模板");
});
```

- [ ] **Step 2: 运行测试确认存储函数尚不存在**

Run: `npx vitest run utils/db.test.ts`

Expected: FAIL，导出函数不存在。

- [ ] **Step 3: 在现有 settings store 实现偏好读写**

```ts
const PROMPT_TEMPLATE_PREFERENCE_ID = "prompt-template-preference";

export const savePromptTemplatePreference = async (promptTemplate: string) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put({ id: PROMPT_TEMPLATE_PREFERENCE_ID, promptTemplate });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const loadPromptTemplatePreference = async (): Promise<string | null> => {
  const db = await initDB();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const request = tx.objectStore("settings").get(PROMPT_TEMPLATE_PREFERENCE_ID);
    request.onsuccess = () => resolve(request.result
      ? String(request.result.promptTemplate ?? "")
      : null);
    request.onerror = () => reject(request.error);
  });
};
```

- [ ] **Step 4: 运行数据库测试确认通过**

Run: `npx vitest run utils/db.test.ts`

Expected: PASS。

- [ ] **Step 5: App 加载偏好并只注入新批次**

```tsx
const [promptTemplatePreference, setPromptTemplatePreference] = useState(DEFAULT_PRODUCT_PROMPT_TEMPLATE);

// initialization: load batches and preference together
const preference = storedPreference ?? DEFAULT_PRODUCT_PROMPT_TEMPLATE;
setPromptTemplatePreference(preference);
if (!storedBatches.length) setBatches([createProductBatch("我的产品批次", preference)]);

const createBatch = () => {
  const next = createProductBatch(`产品批次 ${batches.length + 1}`, promptTemplatePreference);
  setBatches(current => [next, ...current]);
  setActiveBatchId(next.id);
};

const updatePromptTemplate = (promptTemplate: string) => {
  patchActiveBatch({ promptTemplate });
  setPromptTemplatePreference(promptTemplate);
  void savePromptTemplatePreference(promptTemplate);
};
```

删除最后一个批次并创建替代批次时，同样传入 `promptTemplatePreference`。已加载的旧批次不得映射或覆盖模板。

- [ ] **Step 6: 完整运行相关测试与类型检查**

Run: `npx vitest run domain/productWorkflow.test.ts utils/db.test.ts && npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add App.tsx utils/db.ts utils/db.test.ts
git commit -m "feat: remember prompt template preference"
```

### Task 3: 独立操作模式区与参考图拖放

**Files:**
- Modify: `components/ProductSetup.tsx`
- Modify: `index.css`

**Interfaces:**
- Consumes: `onPromptTemplateChange(promptTemplate: string): void`
- `ReferenceUpload` 对点击选择和拖放图片都调用现有 `onSelect(file)`

- [ ] **Step 1: 调整 ProductSetup 属性与结构**

```tsx
interface ProductSetupProps {
  batch: ProductBatch;
  loading: boolean;
  onPatch: (patch: Partial<ProductBatch>) => void;
  onStyleImageSelected: (file: File) => void;
  onProductImageSelected: (file: File) => void;
  onGenerate: () => void;
  onPromptTemplateChange: (promptTemplate: string) => void;
}

<div className="workflow-mode-block">
  <span>操作模式</span>
  <div className="segment-control two workflow-mode-control">
    <button>手动模式</button>
    <button>自动模式</button>
  </div>
</div>
```

将生成方式保留为独立字段；模板 textarea 的 `onChange` 改为 `onPromptTemplateChange`。

- [ ] **Step 2: 为参考图卡片增加统一拖放处理**

```tsx
const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
  event.preventDefault();
  const file = Array.from(event.dataTransfer.files).find(item => item.type.startsWith("image/"));
  if (file) onSelect(file);
};

<div className="reference-card" onDragOver={event => event.preventDefault()} onDrop={handleDrop}>
```

拖入产品图继续调用 App 中的 `applyProductReferenceFilename(..., file.name)`；手动名称保护沿用已通过的领域测试。

- [ ] **Step 3: 添加布局样式**

```css
.workflow-mode-block { padding: 14px; border: 1px solid #cfd9e6; background: #f7f9fc; border-radius: 7px; }
.workflow-mode-control button { min-height: 42px; font-size: 13px; }
.reference-card.drag-active { border-color: var(--blue); background: #f4f8ff; }
```

移动断点下模式区保持整行、按钮不截断；现有卡片圆角不超过 8px。

- [ ] **Step 4: 浏览器验收**

Run: `npm run dev -- --host 127.0.0.1 --port 4175`

检查：
- 桌面和 390px 手机视口下，操作模式独立显示且无溢出。
- 默认模板文本完整出现，创作引导为空。
- 修改模板后新建批次继承新值，原批次内容不变化。
- 拖入 `婚宴酒瓶.png` 后自动名称为 `婚宴酒瓶`；手动改名后再次拖图不覆盖。

- [ ] **Step 5: 完整验证**

Run: `npm test -- --run`

Run: `npx tsc --noEmit`

Run: `npm run build`

Run: `git diff --check`

Expected: 全部通过，浏览器控制台无错误。

- [ ] **Step 6: 提交并部署**

```bash
git add App.tsx components/ProductSetup.tsx index.css
git commit -m "feat: refine product setup workflow"
git push origin main
npx vercel --prod --yes
```

使用 `vercel inspect` 确认 production deployment 为 `Ready`，别名包含 `https://chanpinshengtu.vercel.app`。
