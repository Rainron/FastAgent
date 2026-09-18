/**
 * 同一会话不能同时跑两个 run：Pi session 是会话级的，两个 run 交错写同一份上下文。
 * 主进程用这条消息拒绝，渲染层靠它把这次发送转成排队而不是报错。
 */
export const RUN_CONFLICT_MESSAGE = '该会话已有任务在运行'

const INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_CLASS_PREFIX = /^(?:[A-Za-z]+)?Error:\s*/

/** IPC 回传的错误会被 Electron 包一层，判定前先剥掉与 cleanIpcError 相同的外壳。 */
export function isRunConflictError(cause: unknown): boolean {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  return raw.replace(INVOKE_PREFIX, '').replace(ERROR_CLASS_PREFIX, '').trim() === RUN_CONFLICT_MESSAGE
}
