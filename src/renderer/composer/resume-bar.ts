import type { ResumableRun } from '../../shared/types'

/**
 * 续跑条只在「有中断运行、且当前没有任务在跑」时出现。
 * 正在执行时出现会让用户以为可以并发续跑，实际会撞上会话级串行。
 */
export function shouldShowResumeBar(input: { resumable: ResumableRun | null; running: boolean }): boolean {
  return Boolean(input.resumable) && !input.running
}

/** 中断原因按归类转成一句用户能据此决定要不要续跑的话。 */
export function resumeReasonLabel(run: Pick<ResumableRun, 'errorKind' | 'reason'>): string {
  switch (run.errorKind) {
    case 'network': return '网络中断'
    case 'timeout': return '请求超时'
    case 'model': return '模型异常'
    case 'permission': return '权限被拒'
    case 'sandbox': return '沙箱阻止'
    case 'validation': return '请求不合法'
    case 'cancelled': return '已取消'
    case 'system': return '运行失败'
    // errorKind 为空的多是进程异常退出后启动收敛出来的记录，此时 reason 是「任务已中断」
    default: return run.reason?.trim() || '任务中断'
  }
}

/** 主标签：说清「停在哪」与「还剩多少」，两项都为 0 的运行上游已经过滤掉。 */
export function resumeBarLabel(run: Pick<ResumableRun, 'errorKind' | 'reason' | 'pendingTodos' | 'changedFiles'>): string {
  const parts: string[] = [resumeReasonLabel(run)]
  if (run.pendingTodos > 0) parts.push(`剩 ${run.pendingTodos} 项未完成`)
  if (run.changedFiles > 0) parts.push(`已改 ${run.changedFiles} 个文件`)
  return parts.join(' · ')
}
