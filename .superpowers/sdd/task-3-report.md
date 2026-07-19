# Task 3 Report

## SHA

- 功能提交：`5e8d4b7 feat: refine product setup workflow`

## RED

- 新增 `components/ProductSetup.test.tsx` 后运行 `npx vitest run components/ProductSetup.test.tsx`。
- 预期失败并实际失败：产品参考图拖放没有调用 `onProductImageSelected`；模板编辑没有调用 `onPromptTemplateChange`。

## GREEN

- `ReferenceUpload` 统一处理点击选择和图片拖放，忽略非图片文件，并在拖入期间显示活动状态。
- `ProductSetup` 将模板输入改为调用 `onPromptTemplateChange`；`App` 复用已有的 `updatePromptTemplate` 偏好更新路径。
- 手动/自动模式移动到独立整行区；生成方式保持独立字段。移动端按钮不会截断或造成横向溢出。
- 浏览器验收：1440px 和 390px 视口均无横向溢出；默认模板完整、创作引导为空；修改模板后新建批次继承新值；控制台无错误。

## 修改文件

- `App.tsx`
- `components/ProductSetup.tsx`
- `components/ProductSetup.test.tsx`
- `index.css`

## 验证

- `npx vitest run components/ProductSetup.test.tsx`：2 passed。
- `npm test -- --run`：11 files, 61 tests passed。
- `npx tsc --noEmit`：passed。
- `npm run build`：passed。
- `git diff --check`：passed。

## 自审

- 产品图点击上传和拖放都经由同一个 `onProductImageSelected` 回调，因此继续使用 App 中的 `applyProductReferenceFilename` 和已有的手动命名保护。
- 没有增加运行时依赖，也没有部署或推送。
- 拖放活动样式只在图片拖入时显示，释放或离开卡片后会复位。

## Review Remediation: Image File Selection and Drag State

### Root Cause

- `ReferenceUpload` 的文件选择 `onChange` 只检查文件是否存在，没有像拖放路径一样校验 `image/*`，非图片可能进入 `onSelect` 并触发产品改名。
- 点击和拖放的文件校验路径不一致，拖放状态清理也分散在不同事件处理器中。

### RED

在 `components/ProductSetup.test.tsx` 增加回归覆盖：

- 产品文件 input 选择非图片时忽略。
- 图片 drag-enter 添加 `drag-active`，drag-leave 清理。
- 图片和非图片 drop 后都清理 `drag-active`，且只转发图片文件。

```sh
npm test -- components/ProductSetup.test.tsx
```

修复前结果：1 个预期失败。非图片 file input 仍调用了 `onProductImageSelected` 一次。

### GREEN

- 增加共享的 `isImageFile` 和 `selectImageFile`，点击与拖放统一经过图片校验。
- 增加 `resetDragState`，用于 drag-leave 完成和所有 drop 退出路径。
- 每次 input change 仍会清空 input 值，包括被拒绝的文件。

```text
Test Files  1 passed (1)
Tests  4 passed (4)
```

### Verification

- `npm test`：11 files, 63 tests passed。
- `npx tsc --noEmit`：passed。
- `npm run build`：passed；Vite transformed 1809 modules。
- `git diff --check`：passed。
