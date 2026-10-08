import React, { useEffect, useRef } from 'react'
import { ExternalLink, Plus, TerminalSquare, X } from 'lucide-react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { readCssVariable, terminalTheme } from './terminal-theme'
import { useTerminalSessions } from './use-terminal-sessions'

interface TerminalPanelProps {
  /** 主题变化要重算 xterm 配色：它吃的是具体色值，不认 CSS 变量。 */
  dark: boolean
  onClose: () => void
  onNotice: (message: string) => void
}

/** 会话名只给用户认路，用可执行文件名就够，完整路径太长。 */
function shellLabel(shell: string): string {
  return shell.split(/[\\/]/).pop() || shell
}

/**
 * 一个 xterm 实例复用给所有标签：切标签时清屏并把该会话的缓冲回放一遍。
 * 每个会话各开一个实例更省事，但终端实例带自己的渲染器与缓冲，开多了内存涨得很快。
 */
function TerminalView({ sessionId, dark, onNotice }: { sessionId: string; dark: boolean; onNotice: (message: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({ fontSize: 12.5, fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace', cursorBlink: true, scrollback: 5000, theme: terminalTheme(readCssVariable, dark) })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit
    return () => {
      termRef.current = null
      fitRef.current = null
      term.dispose()
    }
    // dark 只影响配色，单独在下面的 effect 里改，不重建实例
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = terminalTheme(readCssVariable, dark)
  }, [dark])

  // 挂上会话：先把断开期间的输出补齐，再接上增量。
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    let cancelled = false
    term.reset()
    void window.fastAgent.terminal.attach(sessionId).then((attachment) => {
      if (cancelled || !attachment) return
      if (attachment.backlog) term.write(attachment.backlog)
      term.focus()
    }).catch(() => onNotice('接入终端会话失败'))
    const offData = window.fastAgent.terminal.onData((chunk) => { if (chunk.id === sessionId) term.write(chunk.data) })
    const input = term.onData((data) => { void window.fastAgent.terminal.write(sessionId, data).catch(() => onNotice('终端已结束')) })
    return () => { cancelled = true; offData(); input.dispose() }
  }, [sessionId, onNotice])

  // 面板宽高变了就重新按字符格数算一次，并把新尺寸同步给 pty：不同步的话 shell 仍按旧列宽折行。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const apply = () => {
      const term = termRef.current
      const fit = fitRef.current
      if (!term || !fit || !host.clientWidth || !host.clientHeight) return
      fit.fit()
      void window.fastAgent.terminal.resize(sessionId, term.cols, term.rows).catch(() => { /* 会话结束时忽略 */ })
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(host)
    return () => observer.disconnect()
  }, [sessionId])

  return <div className="terminal-surface" ref={hostRef} />
}

/** 内嵌终端面板：会话开在工作区根目录，关掉面板不结束 shell。 */
export const TerminalPanel = React.memo(function TerminalPanel({ dark, onClose, onNotice }: TerminalPanelProps) {
  const { sessions, activeId, ready, create, close, select } = useTerminalSessions(onNotice)
  const active = sessions.find((session) => session.id === activeId) ?? null
  return <aside className="terminal-panel">
    <div className="terminal-panel-head">
      <TerminalSquare size={15} aria-hidden="true" />
      <div className="terminal-tabs" role="tablist">
        {sessions.map((session) => <button
          key={session.id}
          role="tab"
          aria-selected={session.id === activeId}
          className={`terminal-tab${session.id === activeId ? ' active' : ''}`}
          onClick={() => select(session.id)}
        >
          <span>{shellLabel(session.shell)}</span>
          <span className="terminal-tab-close" role="button" aria-label="关闭该终端" onClick={(event) => { event.stopPropagation(); close(session.id) }}><X size={11} /></span>
        </button>)}
        <button className="icon-button" onClick={() => void create()} aria-label="新建终端" title="新建终端"><Plus size={14} /></button>
      </div>
      <button className="icon-button" onClick={() => { void window.fastAgent.workspace.openTerminal().catch(() => onNotice('无法打开系统终端')) }} aria-label="在系统终端打开" title="在系统终端打开"><ExternalLink size={14} /></button>
      <button className="icon-button" onClick={onClose} aria-label="关闭终端面板" title="关闭终端面板"><X size={15} /></button>
    </div>
    {active
      ? <TerminalView key={active.id} sessionId={active.id} dark={dark} onNotice={onNotice} />
      : <p className="terminal-empty">{ready ? '没有正在运行的终端，点上面的 + 新建一个。' : '正在准备终端…'}</p>}
  </aside>
})
