import type { SandboxSettings, SandboxStatus } from '../sandbox'

/** 沙箱能力探测结果，供设置页与输入区状态徽标使用。 */
export interface SandboxCapabilities {
  status: SandboxStatus
  runnerVersion: string | null
  setupVersion: string | null
  accounts: { offline: boolean; online: boolean }
  /** 非 ready 时的错误码，对应 sandbox-errors 的分类 */
  reason: string | null
  checkedAt: number
}

/** 当前 Agent 运行使用的沙箱会话摘要；无活动会话时为 null。 */
export interface SandboxSessionInfo {
  id: string
  workspacePath: string | null
  accountMode: 'offline' | 'online'
  isolation: 'sandboxed' | 'unsandboxed'
  networkMode: SandboxSettings['networkMode']
  createdAt: number
}

/** 沙箱阻断/降级事件的结构化载荷；界面不展示原始系统错误。 */
export interface SandboxNotice {
  code: string
  title: string
  detail: string
  target?: string
  actions: Array<'retry' | 'diagnose' | 'disable'>
}
