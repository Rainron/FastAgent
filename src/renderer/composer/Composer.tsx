import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, ListEnd, Paperclip, X } from 'lucide-react'
import type { Attachment, ConversationMode, GitOperationResult, GitWorkspaceState, LocalSkillRecord, ModelOption, PermissionPreset, ShortcutSettings, ThinkingLevel, WorkspaceFileMatch } from '../../shared/types'
import { findProfile, type PermissionProfile } from '../../shared/permission-profiles'
import type { CompactionState } from '../conversation/compaction-state'
import { ContextHealth, type ContextHealthData } from '../conversation/ContextHealth'
import { activeMentionQuery, applyMention, applySlashCommand, filterSkills, filterSlashCommands, SLASH_COMMANDS, type MentionQuery } from '../conversation/file-mention'
import { FileMentionMenu } from '../conversation/FileMentionMenu'
import { GitBranchTrigger } from '../conversation/GitBranchMenu'
import { createComposerHistory } from '../conversation/composer-history'
import { createLocalStoragePromptHistory, createPromptHistory } from '../conversation/prompt-history'
import type { QueuedPrompt } from '../conversation/prompt-queue'
import { SkillMentionMenu } from '../conversation/SkillMentionMenu'
import { thinkingLevelsForModel } from '../model-picker'
import { effectiveInAppBinding, matchKeyboardBinding } from '../shortcuts'
import { nextConversationMode } from '../workspace-actions'
import type { WorkspaceConversation } from '../workspace/workspace-types'
import { appendAttachments, attachmentFromFile, attachmentsFromClipboard } from './attachments'
import { clampComposerHeight } from './composer-height'
import { useComposerDensity } from './composer-density'
import { ComposerOverflow, ModelSelector, PermissionSelector, ReasoningSelector } from './ComposerSelectors'
import { FullAccessDialog } from './FullAccessDialog'
import { ResumeMenu } from './ResumeMenu'
import { lineBoundary } from './composer-shortcuts'

function SquareIcon() { return <span className="square-icon" aria-hidden="true" /> }

/** 输入区在流式输出期间与内容无关，靠 memo + 稳定回调挡住每帧重绘。 */
export const Composer = React.memo(function Composer({ mode, planMode, onTogglePlanMode, agentAvailable, setMode, model, selectedModelId, models, favoriteModelIds, recentModelIds, onSelectModel, thinkingLevel, onThinkingLevelChange, onToggleFavorite, permission, permissionProfiles, onPermissionChange, onOpenPermissionSettings, attachmentRequest, runId, queue, onEnqueue, onRemoveQueued, quoteRequest, onSend, onCancel, contextHealth, compaction, onCompact, onCancelCompaction, onNewChat, onSelectConversation, onClearConversation, onInitProject, currentProjectId, height, heightPinned, onHeightChange, onManageModels, onNotice, shortcuts, gitState, gitAnyRunActive, onGitCheckout, onGitCreate, onGitStopAndCheckout }: { compaction: CompactionState | null; /** 输入框作用域的快捷键绑定，未设置时回落 DEFAULT_IN_APP_BINDINGS */ shortcuts: ShortcutSettings | undefined; contextHealth: ContextHealthData; onCompact: () => void; onNewChat: () => void; onSelectConversation: (item: WorkspaceConversation) => void; onClearConversation: () => Promise<void>; onInitProject: () => Promise<void>; /** /resume 的语境依据：当前选中项目 id，null 表示快速对话，列表按它过滤。 */ currentProjectId: string | null; mode: ConversationMode; /** 计划模式开启时显示 Plan 标记，回复只产出实施计划 */ planMode: boolean; onTogglePlanMode: () => void; /** Agent 仅在项目会话可用；快速对话固定 chat */ agentAvailable: boolean; setMode: (mode: ConversationMode) => void; model: ModelOption | null; selectedModelId: number | null; models: ModelOption[]; favoriteModelIds: number[]; recentModelIds: number[]; onSelectModel: (modelId: number) => void; thinkingLevel: ThinkingLevel; onThinkingLevelChange: (level: ThinkingLevel) => void; onToggleFavorite: (modelId: number) => void; permission: PermissionPreset | null; /** 可选档位，内置三档恒在最前 */ permissionProfiles: PermissionProfile[]; onPermissionChange: (preset: PermissionPreset) => void; /** 打开设置页的「Agent 执行权限」分区 */ onOpenPermissionSettings: () => void; attachmentRequest: number; runId: string | null; queue: QueuedPrompt[]; onEnqueue: (text: string, attachments: Attachment[]) => void; onRemoveQueued: (id: string) => void; quoteRequest: { text: string; nonce: number } | null; onSend: (text: string, attachments: Attachment[]) => Promise<void>; onCancel: () => void; onCancelCompaction?: () => void; height: number; heightPinned: boolean; onHeightChange: (height: number, pinned: boolean) => void; onManageModels: () => void; onNotice: (notice: string) => void; /** Git 分支展示与切换；null 时不渲染入口。 */ gitState: GitWorkspaceState | null; gitAnyRunActive: boolean; onGitCheckout: (branch: string) => Promise<GitOperationResult>; onGitCreate: (name: string) => Promise<GitOperationResult>; onGitStopAndCheckout: (branch: string) => Promise<GitOperationResult> }) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  // @ 文件提及：mention 为空表示当前没在输入提及。
  const [mention, setMention] = useState<MentionQuery | null>(null)
  const [mentionMatches, setMentionMatches] = useState<WorkspaceFileMatch[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const mentionSeq = useRef(0)
  const mentionDismissed = useRef<number | null>(null)
  // / 触发 skill 补全：进入触发时拉一次技能列表，之后查询只在本地过滤。
  const [skillRecords, setSkillRecords] = useState<LocalSkillRecord[] | null>(null)
  // /pass 切 full 前的档位，退出时恢复。
  const previousPermission = useRef<PermissionPreset | null>(null)
  // 高风险档位（完全访问及继承它的自定义档）只在首次开启时二次确认，之后来回切换不再打断。
  const [riskConfirmed, setRiskConfirmed] = useState(() => findProfile(permissionProfiles, permission).risk)
  // 非空表示正在为该档位征求二次确认。
  const [fullPrompt, setFullPrompt] = useState<PermissionPreset | false>(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // 撤销/重做：受控 textarea 的原生 undo 栈会被程序化改值打断，自建快照栈接管撤销与重做。
  const historyRef = useRef(createComposerHistory())
  // ↑/↓ 发送历史：应用级共享、localStorage 持久化，模块实例只在首次挂载时创建。
  const promptHistoryRef = useRef(createPromptHistory({ storage: createLocalStoragePromptHistory('fastagent.prompt-history') }))
  // /resume 最近会话选择弹层：records 与高亮由 Composer 管理，弹层只管展示。
  const [resumeOpen, setResumeOpen] = useState(false)
  const [resumeList, setResumeList] = useState<WorkspaceConversation[]>([])
  const [resumeIndex, setResumeIndex] = useState(0)
  const resumeSeq = useRef(0)
  const caretRef = useRef(0)
  // 外部编辑会话：草稿路径在窗口重新聚焦时用来读回内容
  const externalEditRef = useRef<{ path: string } | null>(null)
  const lastAttachmentRequest = useRef(attachmentRequest)
  const modeLabel = mode === 'chat' ? 'Chat' : 'Agent'
  const density = useComposerDensity(composerRef)
  const levels = thinkingLevelsForModel(model)
  const overflowed = density === 'compact' && (Boolean(permission) || levels.length > 0)

  /** 程序化改值：先记录变更前快照（强制独立撤销点），再改值并恢复光标。 */
  function setEditorText(next: string, caret?: number) {
    historyRef.current.record({ value: text, caret: caretRef.current }, Date.now(), true)
    setText(next)
    caretRef.current = caret ?? next.length
    requestAnimationFrame(() => {
      const area = textareaRef.current
      if (!area) return
      area.setSelectionRange(caretRef.current, caretRef.current)
    })
  }

  function restoreSnapshot(snapshot: { value: string; caret: number }) {
    setText(snapshot.value)
    caretRef.current = snapshot.caret
    requestAnimationFrame(() => {
      const area = textareaRef.current
      if (!area) return
      area.focus()
      area.setSelectionRange(snapshot.caret, snapshot.caret)
    })
  }

  async function openExternalEditor() {
    try {
      const { path } = await window.fastAgent.composer.openExternalEditor(text)
      externalEditRef.current = { path }
    } catch {
      onNotice('无法打开外部编辑器')
    }
  }

  // 窗口重新获得焦点（用户在外部编辑器保存关闭后切回来）时读回草稿内容回填输入框。
  // 用最新 ref 调 setEditorText，避免闭包捕获旧的 text 把撤销快照记错。
  const consumeExternalEditRef = useRef<() => void>(() => {})
  consumeExternalEditRef.current = () => {
    const session = externalEditRef.current
    if (!session) return
    externalEditRef.current = null
    void window.fastAgent.composer.readExternalEditor(session.path).then((content) => {
      if (content == null) return
      setEditorText(content)
      textareaRef.current?.focus()
    })
  }
  useEffect(() => {
    const onFocus = () => consumeExternalEditRef.current()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  function choosePermission(next: PermissionPreset) {
    // 不能用 window.confirm：Electron 的原生模态关闭后不把键盘焦点还给 webContents，输入框会失灵。
    if (findProfile(permissionProfiles, next).risk && !riskConfirmed) {
      setFullPrompt(next)
      return
    }
    onPermissionChange(next)
  }

  function closeFullPrompt(accepted: boolean) {
    const target = fullPrompt
    setFullPrompt(false)
    if (accepted && target) {
      setRiskConfirmed(true)
      onPermissionChange(target)
    }
    textareaRef.current?.focus()
  }

  // 跟随内容长高、删内容回缩，下限由 clampComposerHeight 兜住。手动拖过之后以用户高度为准。
  useLayoutEffect(() => {
    if (heightPinned) return
    const composer = composerRef.current
    const area = textareaRef.current
    if (!composer || !area) return
    // 输入框高度是外面给的固定值，textarea 的 scrollHeight 会被它撑住量不出真实内容高度；
    // 先把两者放开量一次自然高度，再同步还原，整段都在 layout effect 里做，用户看不到中间态。
    const composerHeightStyle = composer.style.height
    const areaHeightStyle = area.style.height
    composer.style.height = 'auto'
    area.style.height = 'auto'
    const needed = composer.offsetHeight
    composer.style.height = composerHeightStyle
    area.style.height = areaHeightStyle
    const next = clampComposerHeight(needed)
    if (next !== height) onHeightChange(next, false)
  }, [text, attachments.length, heightPinned, height, onHeightChange])

  useEffect(() => {
    const onResize = () => onHeightChange(clampComposerHeight(height), heightPinned)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [height, heightPinned, onHeightChange])

  function startResize(event: React.PointerEvent) {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = composerRef.current?.offsetHeight ?? height
    document.body.classList.add('composer-resizing')
    // 输入框底边贴着窗口底部，所以向上拖变高、向下拖变矮，两条边行为一致。
    const move = (moveEvent: PointerEvent) => onHeightChange(clampComposerHeight(startHeight + startY - moveEvent.clientY), true)
    const stop = () => {
      document.body.classList.remove('composer-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  async function submit() {
    if (compaction?.status === 'running') { onNotice('当前会话正在压缩，暂时无法发送；可切换到其它会话继续问答'); return }
    if (!text.trim()) return
    const value = text.trim()
    // 斜杠命令即时执行：不进聊天记录、不进输入历史，命令名精确匹配（不带参数）。
    const command = SLASH_COMMANDS.find((item) => value === `/${item.name}`)
    if (command) {
      setEditorText('')
      setMention(null)
      runSlashCommand(command.name)
      return
    }
    // 运行中不再拦截发送：问题进队列，回合结束后自动发出。
    if (runId) {
      promptHistoryRef.current.record(value)
      onEnqueue(value, attachments)
      setEditorText(''); setMention(null); setAttachments([])
      onNotice('已加入排队，当前回复完成后自动发送')
      return
    }
    promptHistoryRef.current.record(value)
    setEditorText(''); setMention(null); await onSend(value, attachments); setAttachments([])
  }

  function runSlashCommand(name: string) {
    switch (name) {
      case 'pass':
        // Agent 模式才有权限体系；再次输入退出，恢复进入前的档位。
        if (mode !== 'agent' || !permission) { onNotice('完全访问权限仅在项目会话（Agent 模式）可用'); return }
        if (permission === 'full') {
          // 兜底 'ask'：Agent 模式的默认档位（defaultPermissionForMode 对 chat 返回 null）。
          const restored = previousPermission.current ?? 'ask'
          previousPermission.current = null
          onPermissionChange(restored)
          return
        }
        previousPermission.current = permission
        // 直接切 full 并跳过二次确认：/pass 本身就是明确的放权意图。
        setRiskConfirmed(true)
        onPermissionChange('full')
        return
      case 'new':
        onNewChat()
        return
      case 'resume':
        openResume()
        return
      case 'clear':
        // 运行中清空会让终态写库撞上已删除的回合，先让用户停掉。
        if (runId) { onNotice('/clear：请先停止当前生成再清空会话'); return }
        void onClearConversation()
        return
      case 'init':
        void onInitProject()
        return
      case 'compact':
        onCompact()
        return
      case 'help':
        onNotice(`可用命令：${SLASH_COMMANDS.map((item) => `/${item.name}`).join(' ')}`)
        return
    }
  }

  /** /resume：拉起最近会话列表弹层，选择后交给 WorkspaceShell 恢复。 */
  function openResume() {
    const seq = ++resumeSeq.current
    void window.fastAgent.conversations.list()
      .then((records) => {
        if (seq !== resumeSeq.current) return
        // 只列与当前语境同类的会话：快速对话（未归属项目）或当前项目下的会话。
        const scoped = records.filter((record) => !record.archived && record.projectId === currentProjectId)
        const recent = scoped
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, 8)
          .map((record) => ({ id: record.id, title: record.title, meta: record.updatedAt, archived: false, projectId: record.projectId, modelId: record.modelId }))
        setResumeList(recent)
        setResumeIndex(0)
        if (recent.length === 0) { onNotice('/resume：该语境下暂无历史会话'); return }
        setResumeOpen(true)
      })
      .catch(() => { if (seq === resumeSeq.current) onNotice('/resume：会话列表加载失败') })
  }

  function pickResume(item: WorkspaceConversation) {
    setResumeOpen(false)
    setEditorText('')
    onSelectConversation(item)
  }

  // 「引用到输入框」：把目标消息以 Markdown 引用块追加到输入框，nonce 防止同一条重复注入。
  const lastQuoteNonce = useRef(0)
  useEffect(() => {
    if (!quoteRequest || quoteRequest.nonce === lastQuoteNonce.current) return
    lastQuoteNonce.current = quoteRequest.nonce
    const quoted = quoteRequest.text.split('\n').map((line) => `> ${line}`).join('\n')
    setEditorText(text ? `${text}\n\n${quoted}\n\n` : `${quoted}\n\n`)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [quoteRequest])

  const mentionQuery = mention?.trigger === '@' ? mention.query : null
  useEffect(() => {
    if (mentionQuery === null) { setMentionMatches([]); return }
    // 防抖 + 序号校验：连打时只认最后一次结果，避免旧响应覆盖新候选。
    const seq = ++mentionSeq.current
    const timer = window.setTimeout(() => {
      void window.fastAgent.workspace.searchFiles(mentionQuery)
        .then((matches) => { if (seq === mentionSeq.current) { setMentionMatches(matches); setMentionIndex(0) } })
        // 没打开工作区时 @ 只是没有候选，不该弹错误打断输入。
        .catch(() => { if (seq === mentionSeq.current) setMentionMatches([]) })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [mentionQuery])

  // / 补全：技能列表只在触发激活时拉一次，查询变化不再打 IPC。
  const skillQuery = mention?.trigger === '/' ? mention.query : null
  useEffect(() => {
    if (skillQuery === null) { setSkillRecords(null); return }
    if (skillRecords) return
    let cancelled = false
    void window.fastAgent.skills.list()
      .then((records) => { if (!cancelled) setSkillRecords(records.filter((record) => record.enabled)) })
      .catch(() => { if (!cancelled) setSkillRecords([]) })
    return () => { cancelled = true }
  }, [skillQuery, skillRecords])
  const skillMatches = useMemo(
    () => (skillQuery !== null && skillRecords ? filterSkills(skillRecords, skillQuery).map((item) => ({ ...item, kind: 'skill' as const })) : []),
    [skillQuery, skillRecords]
  )
  // / 菜单候选 = 内置命令 + skill，命令在前；选中统一插入 /name。
  const slashCandidates = useMemo(() => {
    if (skillQuery === null) return []
    return [...filterSlashCommands(SLASH_COMMANDS, skillQuery).map((item) => ({ ...item, kind: 'command' as const })), ...skillMatches]
  }, [skillQuery, skillMatches])
  // 查询变化时两个菜单共用同一个选中下标，重置回第一项。
  useEffect(() => { setMentionIndex(0) }, [mentionQuery, skillQuery])

  function updateMention(area: HTMLTextAreaElement) {
    const next = activeMentionQuery(area.value, area.selectionStart)
    // Esc 关掉之后 keyup 会立刻重新算出同一个提及，不记住就等于 Esc 无效。
    if (next && mentionDismissed.current === next.start) { setMention(null); return }
    mentionDismissed.current = null
    setMention(next)
  }

  function chooseMention(match: WorkspaceFileMatch) {
    if (!mention) return
    const next = applyMention(text, mention, match.path)
    setEditorText(next.text, next.caret)
    setMention(null)
    setMentionMatches([])
    // 走既有附件通道，模型在 chat 与 agent 两种模式下都能拿到文件内容。
    setAttachments((current) => match.isDirectory || current.some((item) => item.localPath === match.absolutePath)
      ? current
      : [...current, { id: crypto.randomUUID(), name: match.path, type: 'text/plain', size: match.size, localPath: match.absolutePath }])
    requestAnimationFrame(() => {
      const area = textareaRef.current
      if (!area) return
      area.focus()
      area.selectionStart = area.selectionEnd = next.caret
    })
  }

  function chooseSkill(item: { name: string; description: string }) {
    if (!mention) return
    // 内置命令保留斜杠前缀，submit 才能识别拦截；skill 只插入名称。
    const isCommand = SLASH_COMMANDS.some((command) => command.name === item.name)
    const next = isCommand ? applySlashCommand(text, mention, item.name) : applyMention(text, mention, item.name)
    setEditorText(next.text, next.caret)
    setMention(null)
    setSkillRecords(null)
    requestAnimationFrame(() => {
      const area = textareaRef.current
      if (!area) return
      area.focus()
      area.selectionStart = area.selectionEnd = next.caret
    })
  }

  function insertNewline(area: HTMLTextAreaElement) {
    // 走 execCommand 是为了保留浏览器自己的撤销栈；失败再退回手动改 state。
    if (document.execCommand('insertText', false, '\n')) return
    const start = area.selectionStart
    const end = area.selectionEnd
    setEditorText(`${text.slice(0, start)}\n${text.slice(end)}`, start + 1)
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // /resume 弹层打开时把导航与确认键全部交给弹层，输入框退居键盘源。
    if (resumeOpen) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setResumeIndex((current) => {
          const next = current + step
          if (next < 0) return resumeList.length - 1
          if (next >= resumeList.length) return 0
          return next
        })
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        const item = resumeList[resumeIndex]
        if (item) pickResume(item)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setResumeOpen(false)
        return
      }
      return
    }
    // 撤销/重做与外部编辑器起草：绑定可在设置里改，优先于其他处理，输入法组词中不拦截
    if (!event.nativeEvent.isComposing) {
      // Ctrl+Q/E 在输入框内定位当前行，避免与浏览器默认的全选行为冲突。
      if (event.ctrlKey && !event.metaKey && (event.key === 'q' || event.key === 'e')) {
        event.preventDefault()
        const boundary = lineBoundary(event.currentTarget.value, event.currentTarget.selectionStart, event.key === 'q' ? 'start' : 'end')
        event.currentTarget.setSelectionRange(boundary, boundary)
        caretRef.current = boundary
        return
      }
      const undoBinding = effectiveInAppBinding(shortcuts, 'composerUndo')
      if (undoBinding && matchKeyboardBinding(event, undoBinding)) {
        event.preventDefault()
        const target = historyRef.current.undo({ value: text, caret: caretRef.current })
        if (target) restoreSnapshot(target)
        return
      }
      const redoBinding = effectiveInAppBinding(shortcuts, 'composerRedo')
      if (redoBinding && matchKeyboardBinding(event, redoBinding)) {
        event.preventDefault()
        const target = historyRef.current.redo({ value: text, caret: caretRef.current })
        if (target) restoreSnapshot(target)
        return
      }
      // 外部编辑器：把当前内容交给设置里指定的编辑器，窗口重新聚焦时回填
      const editorBinding = effectiveInAppBinding(shortcuts, 'externalEditor')
      if (editorBinding && matchKeyboardBinding(event, editorBinding)) {
        event.preventDefault()
        void openExternalEditor()
        return
      }
    }
    // 补全打开时先吃掉导航键，Enter 用来选中候选而不是发送；@ 与 / 两个菜单共用一套导航。
    const activeCount = mention?.trigger === '/' ? slashCandidates.length : mentionMatches.length
    if (activeCount > 0 && mention && !event.nativeEvent.isComposing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : activeCount - 1
        setMentionIndex((current) => (current + step) % activeCount)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        mentionDismissed.current = mention.start
        setMention(null)
        return
      }
      if ((event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        event.preventDefault()
        if (mention.trigger === '/') chooseSkill(slashCandidates[mentionIndex] ?? slashCandidates[0])
        else chooseMention(mentionMatches[mentionIndex] ?? mentionMatches[0])
        return
      }
    }
    // ↑/↓ 浏览发送历史：补全菜单优先已拦截；输入法组词中不拦截。
    // 浏览中始终响应；未浏览时仅输入为空或光标在第一行行首时用 ↑ 进入。
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.nativeEvent.isComposing) {
      const history = promptHistoryRef.current
      if (event.key === 'ArrowUp') {
        if (history.isBrowsing() || text === '' || caretRef.current === 0) {
          event.preventDefault()
          const entry = history.up(text)
          if (entry !== null) setEditorText(entry)
        }
        return
      }
      if (history.isBrowsing()) {
        event.preventDefault()
        const entry = history.down()
        if (entry !== null) setEditorText(entry)
      }
      return
    }
    // Esc 退出历史浏览并恢复暂存草稿。
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      const history = promptHistoryRef.current
      const restored = history.isBrowsing() ? history.cancel() : null
      if (restored !== null) {
        event.preventDefault()
        setEditorText(restored)
      }
    }
    // 输入法组词过程中的 Enter 是确认候选词，不能当成发送。
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    if (event.altKey) {
      // 浏览器不会为 Alt+Enter 插入换行，这里手动补一个，输入框随之长高。
      event.preventDefault()
      insertNewline(event.currentTarget)
      return
    }
    if (event.ctrlKey || event.metaKey) return
    event.preventDefault()
    void submit()
  }

  function addFiles(files: FileList | null) {
    if (!files) return
    setAttachments((current) => appendAttachments(current, Array.from(files).map(attachmentFromFile)))
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = attachmentsFromClipboard(event.clipboardData)
    if (pasted.length === 0) return
    setAttachments((current) => appendAttachments(current, pasted))
    // 文件管理器复制通常没有文本；混合剪贴板则保留文本的默认粘贴行为。
    if (!event.clipboardData.getData('text/plain')) event.preventDefault()
  }
  useEffect(() => {
    if (attachmentRequest !== lastAttachmentRequest.current) {
      lastAttachmentRequest.current = attachmentRequest
      fileInputRef.current?.click()
    }
  }, [attachmentRequest])

  // 应用内快捷键引擎（WorkspaceShell）命中绑定后派发动作事件；
  // 原先直连的 Ctrl+K 监听已移除，命令面板与输入框聚焦统一从这里接。
  useEffect(() => {
    const onShortcut = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'commandPalette') setPickerOpen((open) => !open)
      else if (action === 'focusComposer') textareaRef.current?.focus()
    }
    window.addEventListener('fastagent:shortcut', onShortcut)
    return () => window.removeEventListener('fastagent:shortcut', onShortcut)
  }, [])

  return <div className="composer-wrap"><div className="conversation-content composer" ref={composerRef} style={{ height }}>
    <div className="composer-resize top" onPointerDown={startResize} aria-hidden="true" />
    <div className="composer-resize bottom" onPointerDown={startResize} aria-hidden="true" />
    <div className="composer-top">
      {queue.length > 0 && <div className="composer-queue">
        {queue.map((item, index) => <div className="queue-item" key={item.id}>
          <span className="queue-index">排队 {index + 1}</span>
          <span className="queue-text" title={item.text}>{item.text}{item.attachments.length > 0 ? `（${item.attachments.length} 个附件）` : ''}</span>
          <button onClick={() => onRemoveQueued(item.id)} aria-label="撤销排队" title="撤销排队"><X size={12} /></button>
        </div>)}
      </div>}
      {attachments.map((file) => <span className="attachment-chip" key={file.id}><Paperclip size={12} />{file.name}<button onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))} aria-label={`移除 ${file.name}`}><X size={12} /></button></span>)}
    </div>
    {resumeOpen && <ResumeMenu records={resumeList} activeIndex={resumeIndex} onHover={setResumeIndex} onSelect={pickResume} />}
    {mention?.trigger === '/' && slashCandidates.length > 0
      ? <SkillMentionMenu matches={slashCandidates} activeIndex={mentionIndex} onHover={setMentionIndex} onSelect={chooseSkill} />
      : mentionMatches.length > 0 && <FileMentionMenu matches={mentionMatches} activeIndex={mentionIndex} onHover={setMentionIndex} onSelect={chooseMention} />}
    <textarea
      ref={textareaRef}
      value={text}
      onChange={(event) => {
        // 打字路径：把变更前的状态记入撤销栈，连续打字按时间窗合并
        historyRef.current.record({ value: text, caret: caretRef.current }, Date.now())
        // 浏览时手动改字会让历史浏览态失效（值与当前条目不一致即退出）
        promptHistoryRef.current.previewEdited(event.target.value)
        setText(event.target.value)
        caretRef.current = event.target.selectionStart
        updateMention(event.currentTarget)
      }}
      onSelect={(event) => { caretRef.current = event.currentTarget.selectionStart }}
      onKeyUp={(event) => updateMention(event.currentTarget)}
      onClick={(event) => updateMention(event.currentTarget)}
      onBlur={() => setMention(null)}
      onKeyDown={handleComposerKeyDown}
      onPaste={handleComposerPaste}
      disabled={compaction?.status === 'running'}
      placeholder={compaction?.status === 'running' ? '正在压缩上下文，暂时无法发送；可切换其它会话' : runId ? '生成中，发送将加入排队...' : planMode ? '计划模式：描述要规划的任务...' : mode === 'agent' ? '描述任务目标与期望结果...' : '输入你的问题或想法...'}
      aria-label="消息输入"
      rows={2}
    />
    <div className="composer-toolbar">
      <button className="toolbar-icon" onClick={() => fileInputRef.current?.click()} aria-label="添加附件" title="添加附件"><Paperclip size={16} /></button>
      <input ref={fileInputRef} type="file" multiple accept="image/*,.txt,.md,.json,.csv,.pdf" hidden onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = '' }} />
      {gitState && <GitBranchTrigger state={gitState} compact={density === 'compact'} anyRunActive={gitAnyRunActive} onCheckout={onGitCheckout} onCreate={onGitCreate} onStopAndCheckout={onGitStopAndCheckout} />}
      <div className="toolbar-spacer" />
      {planMode && <button className="composer-chip plan-chip" onClick={onTogglePlanMode} title="计划模式已开启：只产出实施计划，Shift+Tab 或点击退出">Plan</button>}
      <ContextHealth data={contextHealth} onCompact={onCompact} onCancelCompaction={onCancelCompaction} compact={density !== 'wide'} compaction={compaction} />
      <button className="composer-chip mode-chip" onClick={() => agentAvailable && setMode(nextConversationMode(mode))} disabled={!agentAvailable} title={agentAvailable ? `当前模式：${modeLabel}` : '快速对话仅支持 Chat，项目会话可用 Agent'}><span className={`mode-mark ${mode}`} />{modeLabel}<ChevronDown size={13} /></button>
      {permission && !overflowed && <PermissionSelector value={permission} profiles={permissionProfiles} onChange={choosePermission} density={density} onOpenAdvanced={onOpenPermissionSettings} />}
      <ModelSelector model={model} models={models} selectedModelId={selectedModelId} favoriteModelIds={favoriteModelIds} recentModelIds={recentModelIds} open={pickerOpen} onOpenChange={setPickerOpen} onSelectModel={onSelectModel} onToggleFavorite={onToggleFavorite} onManageModels={onManageModels} />
      {levels.length > 0 && !overflowed && <ReasoningSelector levels={levels} value={thinkingLevel} onChange={onThinkingLevelChange} density={density} model={model} />}
      {overflowed && <ComposerOverflow permission={permission} permissionProfiles={permissionProfiles} onPermissionChange={choosePermission} levels={levels} thinkingLevel={thinkingLevel} onThinkingLevelChange={onThinkingLevelChange} model={model} />}
      {runId ? <>
        {Boolean(text.trim()) && <button className="send-button queue" disabled={compaction?.status === 'running'} onClick={() => void submit()} aria-label="加入排队" title="加入排队"><ListEnd size={17} /></button>}
        <button className="send-button stop" onClick={onCancel} disabled={compaction?.status === 'running'} aria-label="停止生成" title="停止生成"><SquareIcon /></button>
      </> : <button className="send-button" onClick={() => void submit()} disabled={!text.trim() || compaction?.status === 'running'} aria-label="发送" title="发送"><ArrowUp size={17} /></button>}
    </div>
  </div>
  {fullPrompt && <FullAccessDialog profile={findProfile(permissionProfiles, fullPrompt)} onRespond={closeFullPrompt} />}
  </div>
})
