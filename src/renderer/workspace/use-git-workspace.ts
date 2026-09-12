import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitWorkspaceState } from '../../shared/types'

/**
 * 当前工作区的 Git 状态；null 表示非仓库或读取失败，工具栏直接不渲染入口。
 * 刷新做防抖：tool_result 事件流与 watcher 广播都会触发，不合并就是每次工具调用一轮 IPC。
 */
export function useGitWorkspace(workspaceRoot: string | null) {
  const [gitState, setGitState] = useState<GitWorkspaceState | null>(null)
  const gitRefreshTimer = useRef<number | null>(null)
  const refreshGitState = useCallback(() => {
    if (gitRefreshTimer.current !== null) window.clearTimeout(gitRefreshTimer.current)
    gitRefreshTimer.current = window.setTimeout(() => {
      gitRefreshTimer.current = null
      void window.fastAgent.git.state().then(setGitState).catch(() => setGitState(null))
    }, 300)
  }, [])
  // 工作区切换或首次挂载（会话恢复）时拉取；切走旧工作区时清空旧状态，避免展示上一个项目的分支。
  useEffect(() => {
    setGitState(null)
    refreshGitState()
  }, [workspaceRoot, refreshGitState])
  // 窗口重新聚焦：用户可能刚从外部终端/IDE 切了分支。
  useEffect(() => {
    const onFocus = () => refreshGitState()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshGitState])
  // 主进程 .git 元数据变化（外部 checkout/switch/commit 等）推送后重新拉取。
  useEffect(() => window.fastAgent.git.onChanged(() => refreshGitState()), [refreshGitState])
  return { gitState, refreshGitState }
}
