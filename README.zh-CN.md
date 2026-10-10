# Fluxyard

**从想法，到成果。**

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的本地优先 AI 桌面工作空间。
Fluxyard 将会话、项目文件、模型配置与实用成果整合进同一个桌面应用。

[English](README.md) · [参与贡献](CONTRIBUTING.md) · [开源许可](LICENSE)

## Fluxyard 是什么？

Fluxyard 面向个人用户，帮助你把需求变成有用的工作成果：打开项目、描述任务、选择模型，
并控制 Agent 可以执行哪些操作。会话和工作区状态保存在本机，模型请求发送至你配置的
提供商。本地优先并不代表模型可以离线运行。

个人桌面端是当前产品。企业 Agent 管理终端将作为独立应用推进，拥有独立的发行包、
应用身份和数据空间，复用运行时无关的基础能力，而不把企业管理功能塞入个人工作台。

**当前状态：预览版，桌面版本 0.4.5。** 当前打包目标为 **macOS Apple Silicon（ARM64）**。
Windows/Linux 发行、macOS 签名与公证尚未提供。

## 设计底座

- **一个工作空间：** 一个窗口、一套会话界面与设置层级。启动加载后直接进入主页；
  连接诊断在需要时通过“帮助”菜单打开。
- **本地数据归属：** 重启与升级保留会话和项目状态，应用不内置模型 API 密钥。
- **可组合能力：** 通过 Harness Host 服务和现有客户端插槽扩展功能，状态绑定当前会话。
- **明确执行边界：** 复用 Harness 沙箱和审批策略；Electron 渲染器沙箱与 Agent 文件权限分别管理。
- **共享底座、独立产品：** 运行时生命周期、资产和用量事实保持框架无关，独立于桌面界面。

## 围绕 DeepSeek Harness 的改造

Harness 提供 Agent 框架、会话界面、模型配置、插件入口、权限预设及 Office 工作流。
Fluxyard 在此基础上进行产品集成，不另造一套 Agent 引擎。

| 方向 | Fluxyard 的改造 |
| --- | --- |
| 桌面交付 | Electron 应用与锁定的 Harness 依赖图；使用 Electron 内置 Node 运行 Harness，用户无需另装 Node。 |
| 启动体验 | 自动启动本地服务，加载后进入主页；模型密钥在设置中配置，不以首次启动弹窗阻挡使用。 |
| 原生窗口 | macOS 侧栏窗口控制与全屏支持，通过针对固定 Harness 版本的检查型适配保留浏览器快捷键路径。 |
| 运行时生命周期 | 经认证的回环 Web 服务、应用所属进程清理、连接恢复诊断，以及独立的 SDK 生命周期适配器。 |
| 演示稿工作空间 | 现有会话输入区中的 PPT 入口；会话级标题、大纲、样式、内容预览、持久保存与可编辑 PPTX 下载。 |
| 会话上下文 | 显式选择后，将保存的大纲加入当前会话下一次上下文快照；不会自动发起模型请求或增加工具。 |
| 打包优化 | 保留运行时资源与许可声明，裁剪非目标平台依赖，检查运行资源并生成压缩 macOS DMG。 |

桌面应用不会向 Agent 内容开放无限制的 Electron 文件系统或进程桥。
模型操作继续通过 Harness 工具及审批机制执行。

## 如何使用

发行包将通过 [GitHub Releases](https://github.com/kernelflux/fluxyard/releases) 提供。
正式发布下载附件前，可以按下方步骤自行构建预览版。

1. 打开 Fluxyard，本地服务自动启动并加载主工作空间。
2. 在 **设置 → 模型** 中配置模型提供商及 API 密钥。
3. 选择或添加工作区，开始会话。
4. 请求修改文件前，选择当前会话的访问模式。设置中的默认值作用于新会话；
   会话输入区的权限控件作用于当前会话。
5. 制作演示稿时，点击输入区下方的 **PPT**，编辑标题和大纲、选择样式，保存后导出可编辑 PPTX。

大纲每段对应一页：首行是标题，其余行是要点，用空行分隔各页。
当前编辑器支持最多 12 页，每页最多 8 个要点。预览用于查看内容，不保证与导出的 PPTX 像素一致。

勾选 **将已保存的大纲用于当前会话** 并保存后，大纲将提供给会话的下一次请求，
不会自动调用模型。目前已实现手动大纲导出，模型自动生成演示稿的完整流程尚未验证。
插件管理沿用 Harness 界面；Fluxyard 插件市场安装器尚未实现。

## 框架与代码结构

| 层次 | 技术与组件 |
| --- | --- |
| 桌面载体 | Electron 43.0.0、沙箱 WebContentsView、隔离 preload |
| Agent 框架 | DeepSeek Harness 0.2.0-rc.2 与 Cordis 插件组合 |
| 用户端扩展 | TypeScript Host 服务与 React 客户端插槽组件 |
| 演示稿导出 | PptxGenJS 4.0.1，可编辑文字和形状 |
| 开发工具 | pnpm workspace、TypeScript、esbuild、Vitest |

```text
apps/desktop/                 桌面应用、运行时分发与打包
apps/cli/                     运行时诊断及基础能力演示
packages/harness-extensions/  会话级用户能力
packages/runtime-node/        运行时生命周期与 Harness 适配器
packages/core/                运行时无关的领域底座
packages/store-json/          本地持久化
```

## 构建与开发

源码开发需要 **Node.js 22.19+** 和 **pnpm 11.7.0**，打包用户无需安装这些工具。
首次安装依赖及打包需要网络；使用模型需要能访问配置的模型提供商。

```bash
pnpm install --frozen-lockfile
pnpm --filter @fluxyard/desktop setup
```

安装固定版本的外部运行时并启动源码开发模式：

```bash
npm ci --prefix apps/desktop/runtime --omit=dev --registry=https://registry.npmjs.org
FLUXYARD_HARNESS_INSTALLATION="$PWD/apps/desktop/runtime" pnpm dev:desktop
```

源码模式使用外部运行时及标准开发窗口。内置用户扩展与原生集成需在打包应用中验收。
源码桌面状态默认保存于 `.fluxyard/desktop/`，可通过 `FLUXYARD_DESKTOP_DATA` 指定其他目录。

在 macOS ARM64 上构建自包含预览版：

```bash
pnpm package:desktop
```

输出位于 `apps/desktop/release/`：

- `0.4.5/Fluxyard-darwin-arm64/Fluxyard.app`
- `Fluxyard-0.4.5-darwin-arm64.dmg` 及 SHA-256 校验文件
- `size-report.json`

当前 DMG 约 244.5 MB。打开后将应用拖入 Applications。
此预览版尚未进行 Developer ID 签名或公证。

## 验证与贡献

```bash
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm fluxyard demo
pnpm fluxyard runtime demo
```

打包后的可执行文件支持 `--smoke`，用于检查 SDK 启停、经认证的 Web 启动及用户插件加载，
不发起模型请求。这些检查不代表模型质量或完整任务执行已经验证。

长期分支只保留 `main`；功能和修复通过短期分支及 Pull Request 协作，
稳定版与预览版通过版本标签和 GitHub Releases 区分。详见 [贡献指南](CONTRIBUTING.md)。

AI 工作日志、本地 Agent 指令和探索文档不纳入版本控制。
公开文档描述产品与实际支持的行为，而不记录开发对话。

## 许可与归属

Copyright © 2026 **kernelflux**。Fluxyard 原创源码采用 **Apache License 2.0**，
详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

DeepSeek Harness、Cordis、Electron 与 PptxGenJS 采用 MIT 许可；第三方组件及其传递依赖
的版权和许可仍归属于各自权利人。发行包保留依赖清单、许可文件与 Electron 声明。
Fluxyard 是独立项目，不是 DeepSeek 官方桌面发行版。
