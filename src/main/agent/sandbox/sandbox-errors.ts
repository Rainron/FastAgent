import type { SandboxNotice } from '../../../shared/types'

export type SandboxErrorCode =
  | 'not_initialized'
  | 'unsupported'
  | 'outdated'
  | 'broken'
  | 'filesystem_denied'
  | 'network_denied'
  | 'process_limit'
  | 'timeout'
  | 'runner_failed'

interface SandboxErrorText {
  title: string
  detail: string
  actions: SandboxNotice['actions']
}

/** 面向普通用户的文案：不把 EPERM / Access Denied 作为唯一错误展示。 */
const TEXTS: Record<SandboxErrorCode, SandboxErrorText> = {
  not_initialized: {
    title: 'Agent 沙箱尚未初始化',
    detail: '需要先完成一次性初始化，才能在受限制的系统环境中执行命令。为保护本机安全，本次 Agent 任务尚未启动。',
    actions: ['diagnose', 'disable']
  },
  unsupported: {
    title: '当前系统不支持 Agent 沙箱',
    detail: 'Agent 沙箱目前只在 Windows 上提供。为保护本机安全，本次 Agent 任务尚未启动。',
    actions: ['disable']
  },
  outdated: {
    title: 'Agent 沙箱组件需要更新',
    detail: '已安装的沙箱运行时版本低于当前应用要求，需要重新初始化。为保护本机安全，本次 Agent 任务尚未启动。',
    actions: ['diagnose', 'disable']
  },
  broken: {
    title: 'Agent 沙箱环境异常',
    detail: '沙箱账户或运行时配置不完整，无法建立受限执行环境。为保护本机安全，本次 Agent 任务尚未启动。',
    actions: ['retry', 'diagnose', 'disable']
  },
  filesystem_denied: {
    title: '操作被沙箱阻止',
    detail: '该目录不允许 Agent 访问。',
    actions: ['diagnose']
  },
  network_denied: {
    title: '网络访问被沙箱阻止',
    detail: '当前网络模式不允许访问该地址。',
    actions: ['diagnose']
  },
  process_limit: {
    title: '进程数超出沙箱限制',
    detail: 'Agent 启动的进程数量超过沙箱允许的上限，已终止本次执行。',
    actions: ['retry']
  },
  timeout: {
    title: '命令执行超时',
    detail: '命令超过允许的执行时限，已被终止。',
    actions: ['retry']
  },
  runner_failed: {
    title: 'Agent 沙箱启动失败',
    detail: '沙箱执行器未能启动。为保护本机安全，本次 Agent 任务尚未启动。',
    actions: ['retry', 'diagnose', 'disable']
  }
}

export class SandboxError extends Error {
  readonly code: SandboxErrorCode
  readonly target?: string

  constructor(code: SandboxErrorCode, options: { target?: string; cause?: unknown } = {}) {
    super(code === 'timeout' && options.target ? `${TEXTS[code].title}：${options.target}` : TEXTS[code].title)
    this.name = 'SandboxError'
    this.code = code
    this.target = options.target
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export function isSandboxError(value: unknown): value is SandboxError {
  return value instanceof SandboxError
}

/** 把任意异常转成界面可直接渲染的结构化说明。 */
export function describeSandboxError(error: unknown): SandboxNotice {
  const code: SandboxErrorCode = isSandboxError(error) ? error.code : 'broken'
  const text = TEXTS[code]
  const target = isSandboxError(error) ? error.target : undefined
  return { code, title: text.title, detail: text.detail, target, actions: [...text.actions] }
}

export const SANDBOX_DEGRADED_NOTICE: SandboxNotice = {
  code: 'unsandboxed_fallback',
  title: 'Agent 沙箱不可用，已按设置直接执行',
  detail: '本次 Agent 命令以当前 Windows 用户身份运行，可以访问工作区之外的文件与本机资源。',
  actions: ['diagnose']
}
