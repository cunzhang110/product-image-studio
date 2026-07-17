# 产品生图工作台

面向单一产品一致性批量创作的 AI 工作台。一个产品批次只需上传一张参考图，系统会先结合提示词模板和创作引导批量生成提示词，人工审核后再批量生图。

线上地址：<https://chanpinshengtu.vercel.app>

## 工作流程

1. 新建产品批次并上传一张产品参考图。
2. 填写提示词模板、创作引导和提示词数量。
3. 使用云雾或 APIMart 的多模态文本模型生成提示词。
4. 编辑、选择、删除、重新生成或追加提示词。
5. 使用云雾、APIMart 或 Muzhi 批量生图。
6. 单独重试失败任务或打包下载当前批次。

同一张产品参考图会同时进入提示词 AI 和每一个生图任务，不需要在每条提示词中手动输入 `@参考图`。

## 固定模型

- Yunwu 图片模型：`gemini-3.1-flash-image-preview`
- APIMart 图片模型：`gpt-image-2`
- Muzhi 图片模型：`gpt-image-2`
- Yunwu 默认提示词模型：`gemini-3-pro-preview`
- APIMart 默认提示词模型：`gemini-2.5-pro`

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm test
npx tsc --noEmit
npm run build
```

## Muzhi 服务端配置

生产环境由独立 Vercel 项目 `product-image-studio` 管理：

- `MUZHI_API_KEY`
- `MUZHI_GENERATIONS_URL=https://api.muzhi.ai/v1/images/generations`
- `MUZHI_EDITS_URL=https://api.muzhi.ai/v1/images/edits`

Muzhi 无参考图时使用 generations 接口；产品批次始终带参考图，因此使用 edits 接口上传产品图。
