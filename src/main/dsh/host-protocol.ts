import type { DshPluginActivation } from '../../shared/types'

/** 挂载一个插件所需的全部信息；宿主进程拿不到 store，只认这份快照。 */
export interface DshMountSpec {
  name: string
  /** 插件入口的绝对路径（package.json 的 main 解析结果） */
  entry: string
  config: Record<string, unknown>
}

export type DshHostRequest =
  | { kind: 'mount'; id: number; specs: DshMountSpec[] }
  | { kind: 'execute'; id: number; callId: string; tool: string; arguments: unknown }
  | { kind: 'cancel'; id: number; target: number }

export type DshHostResponse =
  | { kind: 'ready' }
  | { kind: 'mounted'; id: number; activations: Record<string, DshPluginActivation> }
  | { kind: 'executed'; id: number; isError: boolean; text: string }
  | { kind: 'failed'; id: number; message: string }

/** 宿主进程的启动握手超时；超过这个时间没收到 ready 就当它起不来。 */
export const DSH_HOST_READY_TIMEOUT_MS = 15_000

/** 单次工具调用的兜底超时。插件自身可能不响应取消，不能让一次调用永久占住 run。 */
export const DSH_TOOL_TIMEOUT_MS = 120_000
