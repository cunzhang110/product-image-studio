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
