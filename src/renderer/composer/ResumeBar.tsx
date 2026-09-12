import React, { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ResumableRun } from '../../shared/types'
import { resumeBarLabel, shouldShowResumeBar } from './resume-bar'

/**
 * 输入框上方的「继续上一轮」入口。
 *
 * 恢复永远由用户点击触发，不自动进行：中断可能是权限被拒或沙箱阻止，
 * 自动重跑等于绕过用户刚刚做出的拒绝决定。
 */
export const ResumeBar = React.memo(function ResumeBar({ conversationId, running, onResume }: {
  conversationId: string | null
  running: boolean
  onResume: (runId: string) => void
}) {
  const [resumable, setResumable] = useState<ResumableRun | null>(null)
  const [starting, setStarting] = useState(false)

  // 会话切换或本轮跑完时重查：跑完的那一轮可能正是新的中断
  useEffect(() => {
    let alive = true
    setResumable(null)
    setStarting(false)
    if (!conversationId || running) return
    window.fastAgent.agentRuns.resumable(conversationId)
      .then((found) => { if (alive) setResumable(found) })
      .catch(() => { if (alive) setResumable(null) })
    return () => { alive = false }
  }, [conversationId, running])

  if (!shouldShowResumeBar({ resumable, running }) || !resumable) return null

  // 外层内边距与 AgentRunBar 一致，保证和输入框对齐
  return <div className="run-bar-wrap">
    <div className="conversation-content run-bar-inner">
      <button
        type="button"
        className="run-bar resume"
        disabled={starting}
        onClick={() => {
          setStarting(true)
          onResume(resumable.runId)
        }}
        title="从中断处继续，不重做已完成的步骤"
      >
        <span className="run-bar-icon" aria-hidden="true"><RotateCcw size={12} /></span>
        <span className="run-bar-label">{starting ? '正在继续…' : '继续上一轮'}</span>
        <span className="run-bar-current">{resumeBarLabel(resumable)}</span>
      </button>
    </div>
  </div>
})
