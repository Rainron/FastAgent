// /init 的指令生成：主进程先做一遍静态勘察（project-survey），这里把勘察结果拼成交给 Agent 的
// 任务书。AGENTS.md 由 Agent 用 write 工具落盘——静态模板写出来的永远是占位符，没人会回来填。

import type { ProjectSurvey } from './agent/project-survey'

export const AGENT_INIT_FILE_NAME = 'AGENTS.md'

/** 勘察结果里过长的清单只截给模型一部分：剩下的让它自己用 ls / grep 补。 */
const MAX_PROMPT_ENTRIES = 120
const MAX_PROMPT_COMMANDS = 30

function section(title: string, body: string): string {
  return `## ${title}\n${body || '（未探测到）'}`
}

function renderList(items: string[], limit: number): string {
  if (!items.length) return ''
  const shown = items.slice(0, limit)
  return shown.map((item) => `- ${item}`).join('\n') + (items.length > shown.length ? `\n- …另有 ${items.length - shown.length} 项未列出` : '')
}

/** 把勘察结果渲染成模型可读的事实清单。单独导出便于诊断与测试。 */
export function renderProjectSurvey(survey: ProjectSurvey): string {
  return [
    section('目录结构（已跳过依赖与产物目录）', renderList(survey.entries, MAX_PROMPT_ENTRIES) + (survey.entriesTruncated ? '\n- …条目数超过扫描上限，未列全' : '')),
    section('关键配置文件', renderList(survey.configFiles, MAX_PROMPT_ENTRIES)),
    section('初步识别的技术栈', renderList(survey.stack, MAX_PROMPT_ENTRIES)),
    section('从配置提取的命令', renderList(survey.commands.map((command) => `${command.command}（${command.label}；来源：${command.source}）`), MAX_PROMPT_COMMANDS)),
    section('代码风格采样', renderList(survey.style, MAX_PROMPT_ENTRIES))
  ].join('\n\n')
}

/**
 * /init 交给 Agent 的任务书。
 *
 * 扫描结果只当起点：它是按文件名与依赖名猜的，版本、职责与「命令到底能不能跑」都要 Agent
 * 打开文件核实。任务书里反复要求「不确定就省略」，否则生成的 AGENTS.md 会混进编造的命令，
 * 比没有这份文件更糟。
 */
export function buildAgentInitPrompt(survey: ProjectSurvey): string {
  const existing = survey.existingAgentFile
  const target = existing ?? AGENT_INIT_FILE_NAME
  const existingNote = existing
    ? `项目根目录已有 ${existing}：先完整读一遍，在它的基础上补全与订正。仍然准确的段落和用户自定义章节保留原样，不要整篇重写。`
    : `项目根目录还没有 agent 指令文件，需要新建 ${AGENT_INIT_FILE_NAME}。`

  return `/init：为当前项目生成面向 AI Agent 的项目指南 ${target}。

${existingNote}

下面是主进程已经做过的一遍静态勘察，作为起点使用。它按文件名与依赖名推断，未必准确，凡是要写进文档的结论都要自己核实。

${renderProjectSurvey(survey)}

请按以下步骤完成，每一步都用工具验证，不要凭上面的清单直接下笔：

1. 摸清结构：用 ls 逐层看主要目录，判断每个目录承担什么职责，找出入口文件与核心模块。清单被截断的部分自己补看。
2. 读配置：打开 package.json、tsconfig.json、pyproject.toml、Cargo.toml、go.mod、Dockerfile、CI 配置等实际存在的文件，确认包管理器、运行时版本、构建链路与产物目录。
3. 定技术栈：从依赖清单里确认语言、框架、构建工具、测试框架、样式方案与数据层，带上真实版本号（版本从锁文件或依赖声明里读，不要猜）。
4. 收集命令：从脚本定义里整理构建、运行、测试、类型检查、格式化、打包命令，写成可直接复制执行的形式。只读脚本定义即可，不要为了验证去执行构建或有副作用的命令。
5. 采样风格：挑几个有代表性的源文件读一读，确认命名约定、缩进与引号、导入导出方式、注释语言与粒度、测试文件的存放位置。

核实完后用 write 工具在项目根目录写入 ${target}，按以下结构组织：

# ${survey.name}
## 项目概述 —— 这是什么项目、解决什么问题、给谁用
## 技术栈 —— 语言、框架、构建工具、测试框架、包管理器，带版本
## 目录结构 —— 主要目录及其职责，一行一个
## 常用命令 —— 构建 / 运行 / 测试 / 类型检查 / 格式化，命令可直接复制执行
## 编码规范 —— 命名、缩进、引号、导入导出、注释语言与粒度
## 修改与验证 —— 改动边界，以及提交前必须跑的验证命令

约束：
- 只写核实过的事实。无法确认的条目直接省略，不要编造命令、目录或版本。
- 用中文写，条目简短可执行，不要写成教程或营销文案。
- 除了 ${target} 之外不要新建或修改任何文件。
- 写完后用一段话说明写进了哪些关键信息、哪些没能确认。`
}
