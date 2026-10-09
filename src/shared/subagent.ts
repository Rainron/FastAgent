/**
 * Sub-agent 工具调用上限的推荐值与可配上限。
 *
 * 放在 shared：设置界面要显示推荐值与输入框范围，主进程要拿同一份做归一与执行，
 * 两边各写一个数字迟早会对不上。
 *
 * 之所以限工具调用而不是轮次：pi 的轮次循环在 `session.prompt()` 内部，SDK 不暴露上限选项，
 * 工具调用次数是外部唯一能观测到的边界。
 */
export const SUBAGENT_DEFAULT_MAX_TOOL_CALLS = 40
export const SUBAGENT_MAX_TOOL_CALLS_CEILING = 200

/**
 * Sub-agent 可授予的工具清单。
 *
 * 放在 shared：设置界面要渲染勾选项，主进程要按同一份做归一与白名单展开。
 * `shell` 是逻辑名，主进程按会话的 shell 偏好映射成 bash 或 powershell——
 * 配置里写死 bash 的角色换到 PowerShell 机器上就等于没有命令能力。
 *
 * 刻意不收录的工具：
 * - `todowrite`：待办按会话存，子运行与主运行共用 conversationId，放开就会覆盖主 Agent 的待办。
 * - `question`：澄清问题要回到主 Agent 与用户之间，子任务卡在弹窗上没有人知道它在等什么。
 * - 后台命令：后台进程按会话存活，子任务结束后没人负责停，留给主 Agent。
 */
export const SUBAGENT_READONLY_TOOL_IDS = ['read', 'grep', 'find', 'ls'] as const
export const SUBAGENT_WRITE_TOOL_IDS = ['edit', 'write', 'patch', 'shell'] as const
export const SUBAGENT_TOOL_IDS = [...SUBAGENT_READONLY_TOOL_IDS, ...SUBAGENT_WRITE_TOOL_IDS] as const

export type SubAgentToolId = (typeof SUBAGENT_TOOL_IDS)[number]

export const SUBAGENT_TOOL_LABELS: Record<SubAgentToolId, string> = {
  read: '读取文件',
  grep: '搜索内容',
  find: '查找文件',
  ls: '浏览目录',
  edit: '编辑文件',
  write: '写入文件',
  patch: '应用补丁',
  shell: '执行命令'
}

export function isSubAgentWriteTool(tool: string): boolean {
  return (SUBAGENT_WRITE_TOOL_IDS as readonly string[]).includes(tool)
}
