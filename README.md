# FastAgent

[![CI](https://github.com/Rainron/FastAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/Rainron/FastAgent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Rainron/FastAgent)](https://github.com/Rainron/FastAgent/releases)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6.svg)](https://github.com/Rainron/FastAgent/releases)
[![GitHub stars](https://img.shields.io/github/stars/Rainron/FastAgent?style=social)](https://github.com/Rainron/FastAgent/stargazers)

[English documentation](README.en.md)

FastAgent 是一个**本地优先**的 AI Agent 工作区桌面应用。你自己带模型 API Key，选一个项目目录，它就能读代码、改文件、跑命令、按计划推进任务——所有会话、设置与凭证都留在本机的 `~/.fa` 目录，不经过任何中转服务。

- **本地优先**：会话、设置、凭证只存本机，不经中转服务，也不需要账号。
- **自带模型**：内置 OpenAI、Anthropic、DeepSeek、通义千问、智谱 GLM、Kimi 等预设，支持任意 OpenAI 兼容接口。
- **默认收紧的权限**：fail-closed 权限引擎 + 计划模式 + Rust 实现的 OS 级沙箱，命令只能写当前工作区。
- **可审计**：每一轮的工具调用、审批与耗时都有轨迹；文件改动以写盘后复查磁盘为准，而不是听 Agent 自报。
- **开箱即用**：随包分发固定版本的 ripgrep、fd、jq、7-Zip、MinGit 与 Bash，没装 Git for Windows 也能用真正的 bash。

![主对话与执行轨迹](docs/screenshots/conversation.png)

> 觉得有用？点右上角的 ⭐ Star 就是对项目最直接的支持，也能让更多人发现它。

- 引擎：内嵌 [pi coding-agent](https://github.com/earendil-works/pi) 运行时
- 技术栈：Electron 43 + React 19 + TypeScript + Tailwind 4 + better-sqlite3
- 平台：Windows（沙箱与内置工具链目前只做了 Windows）
- 许可：MIT

## 项目状态

FastAgent 当前处于早期公开版本，优先保证 Windows 本地开发体验与安全边界。项目欢迎围绕文档、测试、兼容性和安全性的真实反馈；功能路线不承诺固定时间表，重大变更会记录在 [CHANGELOG.md](CHANGELOG.md) 中。

如果你准备提交代码，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；发现潜在安全问题，请按照 [SECURITY.md](SECURITY.md) 中的方式报告，不要直接创建公开 Issue。

## 截图

| 主对话与执行轨迹 | 工具权限审批 |
| --- | --- |
| ![主对话](docs/screenshots/conversation.png) | ![权限审批](docs/screenshots/plan-approval.png) |

| 资源面板 | 能力中心 |
| --- | --- |
| ![资源面板](docs/screenshots/resource-panel.png) | ![能力中心](docs/screenshots/abilities.png) |

| 模型连接 | 快速对话小窗 |
| --- | --- |
| ![模型连接](docs/screenshots/model-connections.png) | ![快速对话](docs/screenshots/quick-window.png) |

## 核心能力

**自带模型，不绑定后端**
内置 OpenAI、Anthropic、DeepSeek、通义千问、智谱 GLM、Kimi、MiniMax、Google Gemini、OpenRouter 等厂商预设，也支持任意 OpenAI 兼容接口。API Key 走独立加密表存储，不落明文缓存。配好一个连接即可直接进入工作区。

**两种对话模式**
`chat` 模式提供只读工具与 shell，不写文件；`agent` 模式再放开文件编辑与待办管理，并可用后台 shell 启动开发服务器等长期进程。模式切换即时生效，模型不会拿到当前模式之外的工具。

**计划模式**
写入类工具在权限解析之外被硬拒绝，Agent 只能读代码并输出分步实施计划，确认后再退出计划模式执行。

**权限引擎与审批**
三档预设（询问 / 工作区 / 完全访问）加自定义档位，规则按 last-match-wins 解析，支持「本次允许」「始终允许」。`rm -rf *`、`git push --force` 等全局禁止规则在任何档位都生效；私钥文件（`*.pem`、`id_rsa*` 等）永远拒绝。Agent 连续 3 次重复同一操作会触发死循环守卫并转审批。

**OS 级沙箱**
Rust 实现的沙箱内核：命令跑在受限的系统账户下，只能写当前工作区，工作区外与敏感目录由操作系统拒绝。需要一次管理员初始化。

**内置工具链**
随包分发固定版本的 ripgrep、fd、jq、7-Zip、MinGit 与 Bash——没装 Git for Windows 的机器也能用真正的 bash，而不是降级到 PowerShell。版本与 sha256 写死在 `scripts/fetch-runtime.mjs`，各机器执行环境一致。

**界面与交互**
侧栏宽度可拖拽并记住，长标题悬停自右向左滚动，搜索支持上下键选取、回车进入，项目可拖拽排序。设置中心按「智能体 / 应用 / 安全与诊断」分组导航。执行轨迹可配置用时与 token 位置、摘要文案风格与增删行数，执行过程默认收起、展开有过渡动效；运行中发送的消息会插入当前这一轮。主题为纯白底 + 中性灰，默认强调色湖蓝。

**内嵌终端与 `!` 命令**
会话头部一键开终端面板，在项目目录里直接跑命令，可开多个标签；输出不经过模型。输入框以 `!` 开头也直接执行 shell，命令与输出以卡片留在对话里、可终止或移除，输出落点可选「仅本地展示 / 追加一轮让模型读到 / 回填输入框」。

**项目指令文件按项目信任**
`AGENTS.md` / `CLAUDE.md` 只在该项目被信任时注入系统提示；未信任时只探测存在性、不读内容，并在执行轨迹里说明未加载。信任状态在输入框的项目菜单里切换，已有项目与新增项目默认信任。

**执行轨迹与文件变更账本**
每次工具调用、审批结果、耗时都按轮次归档；写盘工具跑完复查磁盘，给出这一轮每个文件的最终操作与增删行数，而不是听 Agent 自报。

**子 Agent**
只读 Sub-agent 可被主 Agent 委派做调研类任务，角色可自定义，子运行的工具白名单收窄为只读。

**能力中心（Skill / MCP / 插件）**
本地 Skill 管理与校验、MCP 服务器导入与连通性测试（可查看服务器公开的资源与提示词模板）、能力打包成 bundle 导出导入、从 Hub 源安装与更新检查；能力页分为「发现」与「我的能力」两个视图。

**运行状态与模型权限**
运行状态可对账，应用重载后可以接回进行中的任务；模型配置同步与运行过程中的权限控制更加完整。

**界面与会话体验**
会话列表支持分页加载，页面切换、消息操作和工作区交互补充了动效反馈；对话内 Ctrl+F 页内查找（F3 / F4 翻页命中），附件图片可预览，外观支持强调色、字号、界面密度与底色档位，窗口控制按钮自绘，侧栏可搜索会话。

**模型自测**
模型测试走真实的一轮对话，可一键批量测试全部已保存模型。

**模型账号与用量**
支持 Kimi Code 等模型账号登录；设置里的用量统计按模型展示调用量与 token 消耗。

**记忆、知识库与统一搜索**
每一轮对话可见注入与提取了哪些跨会话记忆；可为项目维护知识库并建立索引，搜索页统一检索会话、记忆与知识库。

**技能蒸馏与校验**
把一次成功的对话提炼成可复用的 Skill，并对 Skill 做静态校验。

**运行限额与上下文来源**
可限制并发运行数与重试、续写次数，达到上限后明确停下并说明原因；每一轮上下文的来源可以追溯。会话可导出，产物文件保留逐轮版本并可恢复。

**上下文管理**
按 provider 真实 usage 计量上下文占用（不是字符数除以 4），支持自动摘要与手动压缩，可配触发比例与保留轮次，单个会话可单独设置策略、查看压缩记录，压不动时可选强制压缩（默认关闭）；云端模型的窗口、输出上限等参数可在本机覆盖。

**快速对话小窗**
连按两次 Ctrl 唤起全局小窗；低级键盘钩子只监听不拦截，不影响其他应用的快捷键。鼠标侧键也可绑定。

**其他**
会话管理与分页、全局快捷键自定义、深浅色主题、外部编辑器（Ctrl+G）、`@` 提及文件补全、环境体检（Doctor）、崩溃与启动日志采集、中断任务可续跑。

## 快速开始

只想使用：到 [Releases](https://github.com/Rainron/FastAgent/releases) 下载对应版本的 `FastAgent-<版本>-x64.exe` 安装即可（未代码签名，SmartScreen 会提示「未知发布者」）。

从源码运行需要 Node.js 22+ 与 Windows 10/11。

```bash
git clone https://github.com/Rainron/FastAgent.git
cd FastAgent
npm install
npm run dev
```

首次启动进入登录页，在「模型服务」一侧添加一个模型连接（选厂商 + 填 API Key，或选「自定义 OpenAI 兼容」并填 baseUrl），保存后即可进入工作区。

用起来顺手的话，欢迎 [点个 Star ⭐](https://github.com/Rainron/FastAgent)；遇到问题或想要的功能，直接提 [Issue](https://github.com/Rainron/FastAgent/issues)。

> 登录页另有「FastAgent 账号」Tab、设置里也有「FastAgent 服务器」分区，那是给自建后端做账号登录与模型下发用的可选通道，需要你自己部署服务端。**开源版不需要它**，配好上面的模型连接就能用全部功能。

### 从源码打包

```bash
npm run package:win
```

会依次执行：Vite 构建 → Rust 沙箱原生程序构建（需要 [Rust 工具链](https://rustup.rs)）→ 下载内置工具链 → electron-builder 产出 NSIS 安装包到 `release/`。

产物未做代码签名，Windows SmartScreen 会提示「未知发布者」，这是未签名安装包的正常表现。

### 开发命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动应用并热重载 |
| `npm run build` | Vite 编译，产物到 `out/` |
| `npm run typecheck` | TypeScript 检查（项目唯一静态门槛） |
| `npm test` | Vitest 单次运行（必须在仓库根目录执行） |
| `npm run build:native` | 构建 Rust 沙箱原生程序 |
| `npm run fetch:runtime` | 下载并校验内置工具链 |

## 数据目录

所有数据落在 `~/.fa`：

```
~/.fa
├── fastagent.db      会话、设置、权限规则、能力元数据（SQLite）
├── sessions/         按 用户/创建日期/会话 id 分层的 pi 会话文件
├── skills/  mcp/  plugins/   本地能力
├── attachments/  exports/  backups/
├── cache/  temp/  logs/
```

设置页「数据与存储」可以查看、打开各目录，也可以整体迁移数据根。

## 安全边界

- **权限引擎 fail-closed**：规则命中不到就走审批，不默认放行。
- **安全守卫**：密钥文件分类（`.env`、`.aws/credentials`、私钥等）独立于权限档位判定；私钥类一律拒绝。
- **工作区边界**：工作区外路径映射到独立的 `external_directory` 权限入口。
- **沙箱**：命令执行受操作系统账户权限约束，不依赖 Agent 自觉。
- **死循环守卫**：重复调用达阈值即转审批。
- 日志与诊断导出前做密钥脱敏。

## 架构

主进程按「生命周期 → IPC → 领域模块」分层，渲染层按「容器组件 → hooks → 纯逻辑模块」分层，纯逻辑模块配单元测试（当前 245 个测试文件、2277 个用例）。

- `src/main/` 主进程：agent 引擎（工具运行时、权限引擎、安全守卫、沙箱）、`local-store` 数据层、能力注册表
- `src/preload/` 上下文桥接，向渲染进程暴露类型化 API
- `src/renderer/` React UI，按功能分目录（workspace、composer、conversation、settings、features）
- `src/shared/` 进程间共享类型与规则

## 接下来做什么

后续会继续围绕任务连续性、模型连接和能力生态打磨：包括更细的运行状态恢复、会话与用量管理，以及知识库的检索质量与更多来源类型。

路线图是方向性描述，不承诺固定时间点，做完一块发一块。想优先看到哪个，欢迎提 issue。

## 第三方组件与致谢

感谢以下开源项目的维护者和贡献者。FastAgent 使用这些项目并遵守其各自的许可证：

| 组件 | 用途 | 许可 |
| --- | --- | --- |
| [@earendil-works/pi-coding-agent](https://github.com/earendil-works/pi) | agent 运行时 | MIT |
| [Electron](https://electronjs.org) / React / Tailwind | 应用框架 | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 本地数据库 | MIT |
| [uiohook-napi](https://github.com/SnosMe/uiohook-napi) | 全局键鼠钩子 | MIT |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | 知识库读取 PDF 文本 | Apache-2.0 |
| ripgrep / fd / jq / 7-Zip / MinGit / Bash | 内置工具链，构建时按固定版本下载 | 各自原许可，随包落到 `resources/runtime/*/licenses/` |

打包应用会在适用情况下随对应工具分发原始许可证文件。感谢所有上游维护者和贡献者，他们的工作让 FastAgent 成为可能。

## 参与贡献

欢迎提交文档改进、测试补充、兼容性修复和安全性改进。请先查看 [贡献指南](CONTRIBUTING.md) 与现有 Issue，较大的改动建议先开 Issue 讨论范围。

## 支持项目

如果 FastAgent 帮你省了时间，最简单的支持方式：

- 点一个 [Star ⭐](https://github.com/Rainron/FastAgent/stargazers)
- 分享给同样在用 AI 写代码的朋友
- 提 Issue 反馈真实使用中的问题，或参与贡献

## License

[MIT](LICENSE) © 2026 lake
