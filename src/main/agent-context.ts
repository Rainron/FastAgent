import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppPaths } from './app-paths'

export type AgentContextSource = 'global' | 'project'

export interface AgentContextPath {
  source: AgentContextSource
  name: 'AGENTS.md' | 'CLAUDE.md'
  path: string
}

export interface AgentContextFile extends AgentContextPath {
  content: string
  truncated?: boolean
}

export interface AgentContextReadResult {
  files: AgentContextFile[]
  errors: Array<{ path: string; error: string }>
}

export interface AgentContextReadOptions {
  home?: string
  projectRoot?: string | null
  maxFileCharacters?: number
  maxTotalCharacters?: number
  exists?: (path: string) => boolean
  read?: (path: string) => string
}

/** Agent 指令文件的稳定优先级：项目 AGENTS 最后覆盖同级及全局约定。 */
export function resolveAgentContextPaths(home = homedir(), projectRoot: string | null = null): AgentContextPath[] {
  const paths: AgentContextPath[] = [
    { source: 'global', name: 'CLAUDE.md', path: join(home, '.fa', 'CLAUDE.md') },
    { source: 'global', name: 'AGENTS.md', path: join(home, '.fa', 'AGENTS.md') }
  ]
  if (projectRoot) {
    paths.push(
      { source: 'project', name: 'CLAUDE.md', path: join(projectRoot, 'CLAUDE.md') },
      { source: 'project', name: 'AGENTS.md', path: join(projectRoot, 'AGENTS.md') }
    )
  }
  return paths
}

export function readAgentContextFiles(options: AgentContextReadOptions = {}): AgentContextReadResult {
  const maxFileCharacters = options.maxFileCharacters ?? 50_000
  const maxTotalCharacters = options.maxTotalCharacters ?? 100_000
  const exists = options.exists ?? existsSync
  const read = options.read ?? ((path: string) => readFileSync(path, 'utf8'))
  let total = 0
  const files: AgentContextFile[] = []
  const errors: Array<{ path: string; error: string }> = []
  for (const item of resolveAgentContextPaths(options.home, options.projectRoot ?? null)) {
    if (!exists(item.path)) continue
    try {
      const remaining = Math.max(0, maxTotalCharacters - total)
      const limit = Math.min(maxFileCharacters, remaining)
      const raw = read(item.path).replace(/^\uFEFF/, '')
      const content = raw.slice(0, limit)
      if (content.length) files.push({ ...item, content, truncated: content.length < raw.length })
      total += content.length
    } catch (error) {
      errors.push({ path: item.path, error: error instanceof Error ? error.message : '读取失败' })
    }
  }
  return { files, errors }
}

/** 将已读取的指令文件转换为 system prompt 片段；文件内容不进入普通日志。 */
/** 构造 Agent 需要知道的 FastAgent 持久化目录说明；路径来自运行时解析结果，避免模型误用固定路径。 */
export function buildFaDirectoryContext(paths: Pick<AppPaths, 'dataRoot' | 'dataDir' | 'databasePath' | 'sessionsDir' | 'agentDir' | 'skillsDir' | 'mcpDir' | 'pluginsDir' | 'attachmentsDir' | 'backupsDir' | 'exportsDir' | 'platformUserDataDir' | 'locatorPath'>): string {
  return `## FastAgent 持久化目录说明

当前 FastAgent 数据根目录：\`${paths.dataRoot}\`

该目录属于 FastAgent 桌面应用的内部持久化边界，不是当前项目工作区。目录结构：

- \`${paths.dataDir}\`：应用数据库目录。
- \`${paths.databasePath}\`：SQLite 数据库，保存账户会话、项目、设置、对话、上下文、工具调用、Todo、权限规则及资源元数据。
- \`${paths.sessionsDir}\`：Pi 会话 JSONL 文件。
- \`${paths.agentDir}\`：传给 Pi SDK 的私有 Agent 配置目录；应用关闭了 Pi 的全局 Extension、Skill、Prompt Template 和 Context File 自动发现。
- \`${paths.skillsDir}\`：FastAgent 明确启用的本地 Skill 内容与资源。
- \`${paths.mcpDir}\`：MCP 相关本地目录；MCP 配置和密钥的主要持久化仍由应用存储层管理。
- \`${paths.pluginsDir}\`：插件安装内容和资源。
- \`${paths.attachmentsDir}\`：对话附件。
- \`${paths.backupsDir}\`：本地数据备份。
- \`${paths.exportsDir}\`：数据导出文件。

Electron 平台目录：

- \`${paths.platformUserDataDir}\`：Electron userData，承载平台状态、缓存和迁移期数据，不等同于可迁移业务数据根目录。
- \`${paths.locatorPath}\`：指向当前数据根目录的 locator 文件；迁移数据目录时更新它。

访问边界：以上路径说明用于解释 FastAgent 数据布局，不代表 Agent 获得了访问授权。完全访问模式下，Agent 可以按用户明确要求访问和处理工作区外的本机资源、执行系统命令、安装依赖、联网及使用已启用能力；但安全守卫仍然独立生效：高风险破坏操作会被阻止，私钥文件读取会被拒绝。除非用户明确要求处理 FastAgent 数据，否则不要读取、搜索、修改或删除这些内部目录，也不要通过 Shell 绕过工作区、权限策略或沙箱限制。当前项目源码和 Agent 产物位于用户选择的项目工作区；\`${paths.dataRoot}\` 保存应用数据。处理项目文件时应优先使用工作区工具，不把应用数据库、凭据、会话文件或内部配置当作项目源码修改。`
}

export function mergeAgentContextFiles(files: readonly AgentContextFile[], additionalContext = ''): string {
  const sections = files
    .filter((file) => file.content.trim().length > 0)
    .map((file) => `${file.source === 'global' ? '## 全局' : '## 项目'} Agent 指令：${file.name}\n\n${file.content.trim()}`)
  if (additionalContext.trim()) sections.push(additionalContext.trim())
  return sections.join('\n\n')
}
