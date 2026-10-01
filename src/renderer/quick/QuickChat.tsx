import { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react'
import { Check, ChevronDown, CornerDownLeft, Eraser, Loader2, MessageSquare, Minus, ShieldAlert, Sparkles, Square, Wrench, X } from 'lucide-react'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { AgentEvent, ApprovalDecision, ApprovalRequest, AuthSnapshot, BootstrapData, ConversationMode, ConversationTurn, LocalModelSummary, ModelOption, ThinkingLevel } from '../../shared/types'
import { initialSelectedModelId, mergeModelOptions, modelMetaLabel, normalizeThinkingLevel, thinkingLevelsForModel, triggerModelLabel } from '../model-picker'
import { subscribeLocalModels } from '../local-model-sync'
import { useDismiss } from '../use-dismiss'
import { createStreamBuffer } from '../ai-response/stream-buffer'
import { ReasoningOptions } from '../composer/ComposerSelectors'

// markdown 渲染链路体积大且第一条回答出现前用不到：异步加载，小窗首屏不背这包
const LazyMarkdown = lazy(() => import('react-markdown'))
// 插件数组提升到模块级，避免每次渲染新建 props 导致 Markdown 重挂
const markdownPlugins = { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSanitize] }

/**
 * 快速对话小窗界面：定位是「秒开、直接问、问完就走」。
 * 不复用主界面的会话管理，固定读写标题为「快速对话」的那条会话，保证上下文可追问。
 */

const QUICK_CONVERSATION_TITLE = '快速对话'

interface QuickMessage {
  id: string
  /** tool 是 agent 模式的工具轨迹行，一次调用一行，结果回来时原地改写 */
  role: 'user' | 'assistant' | 'tool'
  text: string
  /** 回答尚未结束时显示加载态 */
  streaming?: boolean
  /** tool 行的结局，用于着色 */
  toolStatus?: 'running' | 'completed' | 'failed'
}

function modelLabel(models: ModelOption[], modelId: number | null): string {
  return models.find((model) => model.id === modelId)?.name ?? '默认模型'
}

/** 工具轨迹行文案：入参摘要（命令/路径）比工具名更有信息量，没有时退回工具名。 */
export function toolLine(event: Pick<AgentEvent, 'tool' | 'input' | 'detail'>): string {
  const summary = (event.input || event.detail || '').replace(/\s+/g, ' ').trim()
  return summary ? `${event.tool} · ${summary.length > 80 ? `${summary.slice(0, 80)}…` : summary}` : String(event.tool)
}

function readQuickPreference(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeQuickPreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* 偏好写入失败不影响使用 */ }
}

export function QuickChat() {
  const [auth, setAuth] = useState<AuthSnapshot | null>(null)
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null)
  const [localModels, setLocalModels] = useState<LocalModelSummary[]>([])
  const [bootstrapLoaded, setBootstrapLoaded] = useState(false)
  const [localModelsLoaded, setLocalModelsLoaded] = useState(false)
  const models = useMemo(() => mergeModelOptions(bootstrap?.models ?? [], localModels), [bootstrap, localModels])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<QuickMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 模型与思考级别：localStorage 记住上次选择，其次回退默认模型；与主窗口互不干扰。
  const [selectedModelId, setSelectedModelId] = useState<number | null>(() => Number(readQuickPreference('fastagent.quick.modelId')) || null)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(() => (readQuickPreference('fastagent.quick.thinking') || 'low') as ThinkingLevel)
  // agent 模式走与主窗口相同的运行时（工具 + 沙箱 + 审批）；未绑定项目时主进程用固定的快速工作区。
  const [mode, setMode] = useState<ConversationMode>(() => readQuickPreference('fastagent.quick.mode') === 'agent' ? 'agent' : 'chat')
  // 待处理的审批：agent 模式下工具执行前会停在这里等用户点按钮
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const configRef = useRef<HTMLDivElement>(null)
  // 清空历史的两段式确认：误触会直接丢掉持久会话的上下文，第一次点击只进入确认态
  const [clearArmed, setClearArmed] = useState(false)
  const runIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 发送新消息时用动画滚动到底；流式文本增长时直接赋值，避免动画被逐 token 打断
  const smoothScrollRef = useRef(false)

  // 主题跟随设置（含 system 档），与主窗口保持同一套 data-theme 令牌
  useEffect(() => {
    let disposed = false
    const apply = (theme: string) => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    void window.fastAgent.settings.get().then((settings) => { if (!disposed) apply(settings.theme) }).catch(() => undefined)
    const off = window.fastAgent.settings.onChange((settings) => apply(settings.theme))
    return () => { disposed = true; off() }
  }, [])

  // 初始化：登录态、模型、快速对话会话与历史
  useEffect(() => {
    let disposed = false
    const modelSync = subscribeLocalModels(window.fastAgent.models, setLocalModels, () => setError('本地模型加载失败'))
    void modelSync.ready.finally(() => { if (!disposed) setLocalModelsLoaded(true) })
    void (async () => {
      const snapshot = await window.fastAgent.auth.snapshot()
      if (disposed) return
      setAuth(snapshot)
      if (snapshot.state !== 'ready') return
      // 本地模型订阅独立于云端请求，云端不可用也能继续更新目录。
      void window.fastAgent.resources.bootstrap()
        .then((data) => { if (!disposed) setBootstrap(data) })
        .catch(() => { if (!disposed) setError('云端模型加载失败') })
        .finally(() => { if (!disposed) setBootstrapLoaded(true) })
      const conversations = await window.fastAgent.conversations.list().catch(() => [])
      if (disposed) return
      const existing = conversations.find((item) => item.title === QUICK_CONVERSATION_TITLE && !item.archived)
      const targetId = existing?.id ?? (await window.fastAgent.conversations.create({ title: QUICK_CONVERSATION_TITLE })).id
      if (disposed) return
      setConversationId(targetId)
      const turns = await window.fastAgent.conversations.history(targetId).catch(() => [])
      if (disposed) return
      // 小窗只展示最近 6 条消息，避免历史过长拖慢唤起
      setMessages(turnsToMessages(turns.slice(-6)))
    })().catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { disposed = true; modelSync.dispose() }
  }, [])

  useEffect(() => {
    if (!bootstrapLoaded || !localModelsLoaded) return
    const next = initialSelectedModelId(models, bootstrap?.default_model_id, selectedModelId)
    if (next !== selectedModelId) setSelectedModelId(next)
    const model = models.find((item) => item.id === next)
    setThinkingLevel((current) => normalizeThinkingLevel(current, model))
  }, [bootstrap, bootstrapLoaded, localModelsLoaded, models, selectedModelId])

  const appendText = useCallback((turnId: string, text: string) => {
    setMessages((current) => {
      const index = current.findIndex((item) => item.id === `a-${turnId}`)
      if (index < 0) return current
      const next = [...current]
      next[index] = { ...next[index], text: next[index].text + text }
      return next
    })
  }, [])

  const streamBuffer = useMemo(() => createStreamBuffer((chunks) => {
    for (const chunk of chunks) appendText(chunk.turnId, chunk.text)
  }, 90), [appendText])

  useEffect(() => () => streamBuffer.dispose(), [streamBuffer])

  // 流式事件：主进程对所有会话统一广播，这里只认当前这次 run
  useEffect(() => {
    return window.fastAgent.chat.onEvent((event: AgentEvent) => {
      if (event.runId !== runIdRef.current || !event.turnId) return
      if (event.type === 'token' && event.text) streamBuffer.push(event.turnId, event.text)
      // agent 模式的工具轨迹：一次调用一行，结果回来时原地改写，不另起新行。
      else if (event.type === 'tool_started' && event.tool) {
        const id = `t-${event.toolCallId || event.eventId || `${event.sequence}`}`
        setMessages((current) => current.some((item) => item.id === id) ? current : [...current, { id, role: 'tool', text: toolLine(event), toolStatus: 'running' }])
      } else if (event.type === 'tool_result' && (event.toolCallId || event.eventId)) {
        const id = `t-${event.toolCallId || event.eventId}`
        setMessages((current) => current.map((item) => item.id === id ? { ...item, toolStatus: event.status === 'failed' ? 'failed' : 'completed' } : item))
      } else if (event.type === 'approval_required' || event.type === 'question_required') {
        if (event.approval) setApproval(event.approval)
      } else if (event.type === 'approval_resolved') {
        setApproval((current) => current && event.approval && current.id === event.approval.id ? null : current)
      } else if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'interrupted') {
        streamBuffer.flush()
        if (event.type === 'failed') setError(event.detail || '回答失败')
        else if (event.type === 'interrupted') setError(event.detail || '回答中断')
        setMessages((current) => current.map((item) => item.id === `a-${event.turnId}` ? { ...item, streaming: false } : item))
        setApproval(null)
        setBusy(false)
        runIdRef.current = null
        inputRef.current?.focus()
      }
    })
  }, [streamBuffer])

  // agent 一轮要跑几分钟且中途要点审批：运行期间钉住小窗，失焦不隐藏。
  // chat 模式维持「问完就走」的原行为，不钉。
  useEffect(() => {
    const pin = (busy && mode === 'agent') || approval !== null
    void window.fastAgent.quick.setPinned(pin).catch(() => undefined)
    // 组件卸载（窗口关闭）时务必解钉，否则小窗永远不再自动隐藏。
    return () => { if (pin) void window.fastAgent.quick.setPinned(false).catch(() => undefined) }
  }, [approval, busy, mode])

  // 新消息自动滚到底部：发送瞬间平滑滚动，流式增长期间直接定位（内容持续变高，动画永远追不上）
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const smooth = smoothScrollRef.current
    smoothScrollRef.current = false
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [messages])

  const send = useCallback(async () => {
    const prompt = draft.trim()
    if (!prompt || busy) return
    if (!conversationId) { setError('会话尚未就绪，请稍候'); return }
    setError(null)
    setDraft('')
    const turn = await window.fastAgent.chat.quickSend({
      conversationId,
      prompt,
      modelId: selectedModelId ?? bootstrap?.default_model_id ?? null,
      thinkingLevel,
      mode,
      // 小窗没有完整的权限面板，agent 一律用「询问」档，写入与执行都要用户点一下。
      permission: mode === 'agent' ? 'ask' : null
    }).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); return null })
    if (!turn) return
    // 本次更新把「用户消息 + 助手占位」一起加进列表，滚动动画只在这一刻生效一次
    smoothScrollRef.current = true
    runIdRef.current = turn.runId
    setBusy(true)
    setMessages((current) => [
      ...current,
      { id: `u-${turn.turnId}`, role: 'user', text: prompt },
      // 流式 token 事件按 turnId 追加，助手占位行 id 直接用 a-<turnId> 对齐
      { id: `a-${turn.turnId}`, role: 'assistant', text: '', streaming: true }
    ])
  }, [bootstrap, busy, conversationId, draft, mode, selectedModelId, thinkingLevel])

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next: ConversationMode = current === 'agent' ? 'chat' : 'agent'
      writeQuickPreference('fastagent.quick.mode', next)
      return next
    })
  }, [])

  const cancelRun = useCallback(() => {
    const runId = runIdRef.current
    if (!runId) return
    void window.fastAgent.chat.cancel(runId).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  const respondApproval = useCallback((decision: ApprovalDecision) => {
    const runId = runIdRef.current
    if (!approval || !runId) return
    setApproval(null)
    void window.fastAgent.chat.respondApproval(approval.id, decision, undefined, runId)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [approval])

  // 选择模型：记住偏好；若当前思考级别不在新模型的可用集里，回退到该模型的默认级别
  const selectModel = useCallback((modelId: number) => {
    setSelectedModelId(modelId)
    writeQuickPreference('fastagent.quick.modelId', String(modelId))
    const next = models.find((model) => model.id === modelId)
    setThinkingLevel((current) => {
      const nextLevel = normalizeThinkingLevel(current, next)
      writeQuickPreference('fastagent.quick.thinking', nextLevel)
      return nextLevel
    })
  }, [bootstrap, models])

  const changeThinkingLevel = useCallback((level: ThinkingLevel) => {
    setThinkingLevel(level)
    writeQuickPreference('fastagent.quick.thinking', level)
  }, [])

  useDismiss(configOpen, () => setConfigOpen(false), configRef)

  // 清空：删除固定标题的持久会话并重建同名空会话，界面与上下文同时归零
  const clearAll = useCallback(async () => {
    if (busy || !conversationId) return
    setClearArmed(false)
    setError(null)
    const created = await window.fastAgent.conversations.create({ title: QUICK_CONVERSATION_TITLE }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    })
    if (!created) return
    void window.fastAgent.conversations.remove(conversationId).catch(() => undefined)
    runIdRef.current = null
    setConversationId(created.id)
    setMessages([])
    inputRef.current?.focus()
  }, [busy, conversationId])

  if (auth && auth.state !== 'ready') {
    return <div className="quick-chat quick-chat-empty"><Sparkles size={18} /><p>快速对话需要先登录账户</p><span>在主窗口登录后，再次连按两次 Ctrl 即可使用</span></div>
  }

  return <div className="quick-chat">
    <header className="quick-chat-header">
      <div className="quick-chat-title"><Sparkles size={13} /><span>快速对话</span>
        <div className="quick-config" ref={configRef}>
          <button className="quick-config-trigger" onClick={() => setConfigOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={configOpen} title="选择模型与思考强度">
            <span>{modelLabel(models, selectedModelId)}</span><ChevronDown size={11} />
          </button>
          {configOpen && <QuickConfigPopover models={models} selectedModelId={selectedModelId} onSelectModel={selectModel} thinkingLevel={thinkingLevel} onThinkingLevelChange={changeThinkingLevel} />}
        </div>
      </div>
      <div className="quick-chat-header-actions">
        <button
          className={`quick-mode-toggle${mode === 'agent' ? ' active' : ''}`}
          aria-pressed={mode === 'agent'}
          disabled={busy}
          title={mode === 'agent' ? 'Agent 模式：可执行命令与改文件，每步需确认' : '对话模式：只回答，不碰本地环境'}
          onClick={toggleMode}
        >{mode === 'agent' ? <Wrench size={12} /> : <MessageSquare size={12} />}<span>{mode === 'agent' ? 'Agent' : '对话'}</span></button>
        {messages.length > 0 && <button
          className={`icon-button${clearArmed ? ' quick-chat-clear-armed' : ''}`}
          aria-label={clearArmed ? '确认清空全部内容' : '清空全部内容'}
          title={clearArmed ? '再点一次确认清空' : '清空全部内容'}
          disabled={busy}
          onClick={() => (clearArmed ? void clearAll() : setClearArmed(true))}
          onBlur={() => setClearArmed(false)}
        ><Eraser size={14} /></button>}
        <button className="icon-button" aria-label="隐藏窗口" title="隐藏（Esc）" onClick={() => void window.fastAgent.quick.hide()}><Minus size={14} /></button>
      </div>
    </header>
    <div className="quick-chat-body" ref={scrollRef}>
      {messages.length === 0 && !error && <div className="quick-chat-hint">{mode === 'agent'
        ? '描述要做的事，Enter 执行；可运行命令与改文件，每一步都会先问你。'
        : '直接输入问题，Enter 发送；支持追问，上下文保留。'}</div>}
      {messages.map((message) => message.role === 'tool'
        ? <div key={message.id} className={`quick-chat-tool quick-chat-tool-${message.toolStatus ?? 'running'}`}>
          {message.toolStatus === 'running' ? <Loader2 size={11} className="quick-chat-spin" /> : message.toolStatus === 'failed' ? <X size={11} /> : <Check size={11} />}
          <span>{message.text}</span>
        </div>
        : <div key={message.id} className={`quick-chat-message quick-chat-message-${message.role}`}>
        {message.role === 'assistant'
          ? message.text
            ? <Suspense fallback={<span>{message.text}</span>}><LazyMarkdown {...markdownPlugins}>{message.text}</LazyMarkdown></Suspense>
            : <span className="quick-chat-loading"><Loader2 size={13} className="quick-chat-spin" />思考中…</span>
          : message.text}
        {message.streaming && message.text && <span className="quick-chat-caret" />}
      </div>)}
      {error && <div className="quick-chat-error">{error}</div>}
    </div>
    {approval && <QuickApprovalBar approval={approval} onRespond={respondApproval} />}
    <footer className="quick-chat-composer">
      <textarea
        ref={inputRef}
        autoFocus
        rows={1}
        value={draft}
        placeholder={busy ? (mode === 'agent' ? '执行中…' : '回答中…') : (mode === 'agent' ? '描述要做的事，Enter 执行' : '输入问题，Enter 发送')}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { void window.fastAgent.quick.hide(); return }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void send()
          }
        }}
      />
      {/* agent 一轮可能跑很久，小窗必须能就地停下，否则只能跑去主窗口点停止 */}
      {busy && mode === 'agent'
        ? <button className="quick-chat-send quick-chat-stop" aria-label="停止执行" title="停止执行" onClick={() => void cancelRun()}><Square size={12} /></button>
        : <button className="quick-chat-send" disabled={!draft.trim() || busy} aria-label="发送" onClick={() => void send()}>
          {busy ? <Loader2 size={14} className="quick-chat-spin" /> : <CornerDownLeft size={14} />}
        </button>}
    </footer>
  </div>
}

/**
 * 行内审批条：agent 在小窗里执行到需要授权的工具时停在这里。
 * question 类请求小窗没有作答界面，只提示到主窗口继续——直接拒绝会让 Agent 以为用户否决了方案。
 */
function QuickApprovalBar({ approval, onRespond }: { approval: ApprovalRequest; onRespond: (decision: ApprovalDecision) => void }) {
  if (approval.kind === 'question') {
    return <div className="quick-approval quick-approval-question">
      <ShieldAlert size={13} />
      <div className="quick-approval-body"><strong>Agent 需要你回答问题</strong><span>小窗不支持作答，请到主窗口继续这次任务</span></div>
    </div>
  }
  return <div className={`quick-approval${approval.risk ? ' quick-approval-risk' : ''}`}>
    <ShieldAlert size={13} />
    <div className="quick-approval-body">
      <strong>{approval.tool}</strong>
      <span title={approval.subject}>{approval.subject || approval.cwd}</span>
    </div>
    <div className="quick-approval-actions">
      <button className="quick-approval-allow" onClick={() => onRespond('once')}>允许一次</button>
      <button onClick={() => onRespond('session')}>本次会话允许</button>
      <button className="quick-approval-reject" onClick={() => onRespond('reject')}>拒绝</button>
    </div>
  </div>
}

function turnsToMessages(turns: ConversationTurn[]): QuickMessage[] {
  const messages: QuickMessage[] = []
  for (const turn of turns) {
    messages.push({ id: `${turn.id}-user`, role: 'user', text: turn.userMessage.text })
    const reply = turn.assistantMessage?.text ?? ''
    if (reply) messages.push({ id: `${turn.id}-reply`, role: 'assistant', text: reply })
  }
  return messages
}

/** 小窗配置弹层：模型列表 + 思考强度，选中即生效并持久化。 */
function QuickConfigPopover({ models, selectedModelId, onSelectModel, thinkingLevel, onThinkingLevelChange }: { models: ModelOption[]; selectedModelId: number | null; onSelectModel: (modelId: number) => void; thinkingLevel: ThinkingLevel; onThinkingLevelChange: (level: ThinkingLevel) => void }) {
  const selected = models.find((model) => model.id === selectedModelId) ?? null
  const levels = thinkingLevelsForModel(selected)
  const activeThinking = levels.includes(thinkingLevel) ? thinkingLevel : levels[0]
  return <div className="quick-config-popover popover-card" role="dialog" aria-label="模型与思考配置">
    {levels.length > 0 && <div className="quick-config-section">
      <div className="popover-heading">思考强度</div>
      <ReasoningOptions levels={levels} value={activeThinking} model={selected} onSelect={onThinkingLevelChange} />
    </div>}
    <div className="quick-config-section">
      <div className="popover-heading">模型</div>
      <div className="quick-model-list">
        {models.map((model) => (
          <button key={model.id} className={`quick-model-item ${model.id === selectedModelId ? 'selected' : ''}`} onClick={() => onSelectModel(model.id)} aria-pressed={model.id === selectedModelId} title={triggerModelLabel(model)}>
            <span><strong>{model.model_name}</strong><small>{modelMetaLabel(model)}</small></span>
            {model.id === selectedModelId && <Check size={14} className="quick-config-check" />}
          </button>
        ))}
      </div>
    </div>
  </div>
}
