import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatShellCommandOutput, normalizeShellCommandSettings, truncateShellOutput } from '../../../shared/shell-command'
import type { ConversationTurn, ShellCommandResult, ShellCommandSettings } from '../../../shared/types'
import { createStreamBuffer } from '../../ai-response/stream-buffer'
import type { ShellCommandEntry } from '../../conversation/shell-entries'
import { createShellCommandLifecycle } from '../../conversation/shell-command-lifecycle'

export interface ShellCommandHandlers {
  /** 命令的完整结果；落点为 context / composer 时由调用方决定怎么用 */
  onFinished(result: ShellCommandResult, settings: ShellCommandSettings): void
  onNotice(notice: string): void
}


/**
 * `!命令` 的本地台账。
 *
 * 输出不落库：这些命令是用户临时看一眼环境，切走会话就该干净。要进模型上下文
 * 或回填输入框由 onFinished 的调用方处理，本 hook 只管执行与展示。
 * 增量输出走 stream-buffer 按帧冲刷，`!npm run build` 这种刷屏命令不会把列表逼到逐行重绘。
 */
export function useShellCommands(conversationId: string | null, handlers: ShellCommandHandlers, settingsOverride?: ShellCommandSettings) {
  const [entries, setEntries] = useState<ShellCommandEntry[]>([])
  const settings = normalizeShellCommandSettings(settingsOverride)
  // 回调每次渲染都是新引用，effect 只读 ref，避免订阅随渲染反复重建。
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const lifecycleRef = useRef(createShellCommandLifecycle())

  useEffect(() => {
    lifecycleRef.current.dispose((id) => { void window.fastAgent.shell.cancelCommand(id).catch(() => undefined) })
    setEntries([])
    return () => lifecycleRef.current.dispose((id) => { void window.fastAgent.shell.cancelCommand(id).catch(() => undefined) })
  }, [conversationId])

  const buffer = useMemo(() => createStreamBuffer((chunks) => {
    const byId = new Map(chunks.map((chunk) => [chunk.turnId, chunk.text]))
    setEntries((current) => {
      if (!current.some((item) => byId.has(item.id))) return current
      return current.map((item) => {
        const text = byId.get(item.id)
        if (text === undefined) return item
        const next = truncateShellOutput(item.output + text)
        return { ...item, output: next.text, truncated: item.truncated || next.truncated }
      })
    })
  }), [])
  useEffect(() => () => buffer.dispose(), [buffer])

  useEffect(() => window.fastAgent.shell.onCommandOutput(({ id, chunk }) => buffer.push(id, chunk)), [buffer])

  // 切会话时清台账：命令输出属于「刚才在这条会话里看了一眼」，不跨会话延续。
  useEffect(() => { buffer.flush(); setEntries([]) }, [conversationId, buffer])

  const run = useCallback(async (command: string, anchorTurnId: string | null) => {
    const id = `sc-${crypto.randomUUID()}`
    const commandConversationId = conversationId
    const scope = lifecycleRef.current.begin(id, commandConversationId)
    const finishedHandler = handlersRef.current.onFinished
    setEntries((current) => [...current, {
      id,
      command,
      anchorTurnId,
      output: '',
      status: 'running',
      exitCode: null,
      error: null,
      truncated: false,
      cwd: '',
      startedAt: Date.now(),
      finishedAt: null
    }])
    try {
      const result = await window.fastAgent.shell.runCommand({ id, command, conversationId: commandConversationId })
      if (!lifecycleRef.current.current(id, scope, conversationId)) return
      lifecycleRef.current.finish(id)
      // 结果里的 output 是主进程侧的权威副本（已按上限截断），直接覆盖流式拼出来的那份。
      buffer.flush()
      setEntries((current) => current.map((item) => item.id === id ? {
        ...item,
        output: truncateShellOutput(result.output).text,
        status: result.status,
        exitCode: result.exitCode,
        error: result.error,
        truncated: result.truncated || truncateShellOutput(result.output).truncated,
        cwd: result.cwd,
        finishedAt: Date.now()
      } : item))
      finishedHandler(result, settingsOverride ?? settings)
    } catch (error) {
      if (!lifecycleRef.current.current(id, scope, conversationId)) return
      lifecycleRef.current.finish(id)
      buffer.flush()
      const message = error instanceof Error ? error.message : String(error)
      setEntries((current) => current.map((item) => item.id === id ? { ...item, status: 'failed', error: message, finishedAt: Date.now() } : item))
    }
  }, [conversationId, buffer, settings, settingsOverride])

  const cancel = useCallback((id: string) => {
    void window.fastAgent.shell.cancelCommand(id).then((stopped) => {
      if (!stopped) handlersRef.current.onNotice('命令已经结束了')
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setEntries((current) => current.filter((item) => item.id !== id))
  }, [])

  return { entries, settings, run, cancel, dismiss }
}

/** context 落点用：把结果写成一轮不发给模型跑的问答，历史里能看到、下一轮模型也读得到。 */
export async function persistShellCommandTurn(conversationId: string, result: ShellCommandResult, modelId: number | null): Promise<ConversationTurn> {
  const turn = await window.fastAgent.conversations.createTurn({
    conversationId,
    prompt: `!${result.command}`,
    attachments: [],
    modelId,
    thinkingLevel: 'auto',
    mode: 'chat',
    permission: null
  })
  const updated = await window.fastAgent.conversations.updateTurn(turn.id, {
    assistantMessage: { text: formatShellCommandOutput(result), createdAt: new Date().toISOString() },
    status: 'completed'
  })
  return updated ?? turn
}
