# Custom Same-Scene Branches Design

## Goal

Extend `同场景多机位` with two branch-planning modes while preserving the existing random behavior:

- `AI 随机延伸`: AI plans the derived camera views.
- `自定义思维导图`: the user defines one editable branch node per derived image.

`多场景创意` remains an independent generation strategy and keeps its current manual and automatic workflows.

## Workflow Matrix

| Operation mode | Generation strategy | Branch behavior |
| --- | --- | --- |
| Automatic | Multi-scene creative | AI creates independent scene prompts and generates all images. |
| Manual | Multi-scene creative | AI creates independent prompts; the user reviews and selects them before generation. |
| Automatic | Same-scene + AI random | AI creates the master scene and random camera branches, then generates all images without pausing. |
| Manual | Same-scene + AI random | AI creates the master scene and random branches, generates the master, then pauses for approval. |
| Automatic | Same-scene + custom branches | The user edits branch nodes before starting; the system generates the master and every branch without pausing. |
| Manual | Same-scene + custom branches | The user edits branches before starting; after the master is generated, the system pauses and allows nodes to be added, edited, copied, reordered, or deleted before continuing. |

## Domain Model

Add these persisted types:

```ts
type SameSceneBranchMode = "ai-random" | "custom-map";
type ExtensionNodeType = "camera" | "action" | "camera-action";

interface SceneExtensionNode {
  id: string;
  type: ExtensionNodeType;
  instruction: string;
}
```

Each `ProductBatch` stores `sameSceneBranchMode` and `extensionNodes`. Existing batches migrate to `ai-random`, preserving current behavior.

## Default Wine-Bottle Template

The first time a batch switches to `custom-map`, populate five editable nodes:

1. `camera`: 左侧 45 度酒瓶近景，保持瓶身标签正面清晰可见
2. `camera`: 顶部俯拍场景全景，完整展示桌面布置与酒瓶位置
3. `camera`: 低机位瓶身与标签细节特写，背景轻微虚化
4. `action`: 人物手持酒瓶，瓶身标签正对镜头
5. `camera-action`: 打开酒瓶并向酒杯倒酒，保持原场景与产品外观一致

The node editor supports add, edit, type change, copy, move up/down, delete, and restore defaults.

## Quantity Rules

- Multi-scene creative continues to use `提示词数量`.
- Same-scene AI random continues to use `提示词数量`; the total includes the master image.
- Same-scene custom map hides `提示词数量`.
- Custom-map output count is always `1 master + extensionNodes.length`.
- The UI shows `预计生成 N 张（主图 1 张 + 分支 M 张）`.
- At least one non-empty custom node is required before starting.

## Prompt Architecture

Custom branches use two prompt layers:

1. The prompt model analyzes the style reference and creates the master-scene prompt plus a persisted `sceneBible`.
2. Derived prompts are assembled deterministically from `sceneBible`, the approved master image, the node type, and the node instruction.

This avoids another AI call after manual master approval and ensures node edits immediately affect the derived jobs.

Branch locks vary by node type:

- `camera`: allow camera direction, height, distance, focal length, framing, and depth of field to change; lock product state, product placement, environment, props, and lighting.
- `action`: allow product position, hand interaction, and use state to change; lock camera style, environment, props, and lighting.
- `camera-action`: allow both the specified camera and action changes; lock product identity, scene structure, props, lighting, and overall tone.

Every branch prompt preserves product color, transparency, material, bottle shape, cap, label, logo, text, proportions, and structure. The master scene remains the environment reference and the product reference remains the authoritative product source.

## Manual Editing After The Master

In manual custom-map mode, changing nodes while awaiting master approval rebuilds only the derived prompt variants. It never regenerates the accepted master image. Continuing creates jobs from the latest node order and instructions.

In automatic custom-map mode, nodes are locked for the duration of the active run. Stopping the run restores editing and `继续剩余任务` uses the persisted node set without regenerating completed images.

## UI Design

Under `同场景多机位`, show a two-option segmented control:

- `AI 随机延伸`
- `自定义思维导图`

Custom mode replaces the prompt-count control with a compact branch editor. The master scene is shown as the root, with a connected vertical child list. Each child contains:

- a node-type menu,
- a multiline extension instruction,
- copy, move, and delete icon buttons,
- a stable branch number.

Commands appear below the list: `添加延伸节点` and `恢复酒瓶模板`. The editor remains usable on mobile as a single-column list without overlapping controls.

## Validation And Error Handling

- Empty custom nodes cannot start and show `请至少添加一个延伸节点`.
- A node with an empty instruction is highlighted and blocks start.
- Node changes are persisted through the existing IndexedDB batch save.
- Failed derived jobs keep their node prompt snapshot and remain individually retryable.
- Stop/resume semantics remain unchanged: completed jobs are retained and only unfinished jobs resume.

## Tests

- New and migrated batches default to `ai-random`.
- Switching to custom mode creates the five wine-bottle nodes once and does not overwrite user edits on later switches.
- Custom quantity equals one plus the number of non-empty nodes.
- Custom branch prompt locks and allowances differ correctly for camera, action, and combined nodes.
- Custom jobs follow node order and preserve node prompt snapshots.
- Manual custom mode reuses the accepted master after node edits.
- Automatic custom mode generates all branches.
- Multi-scene and AI-random tests remain unchanged and green.
- Desktop and mobile layouts show usable node controls without overlap.
