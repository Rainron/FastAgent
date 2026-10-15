import { useMemo, useState } from 'react'
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react'
import type { AppSettings, ThinkingLevel } from '../../shared/types'
import { isSubAgentWriteTool, SUBAGENT_DEFAULT_MAX_TOOL_CALLS, SUBAGENT_MAX_TOOL_CALLS_CEILING, SUBAGENT_READONLY_TOOL_IDS, SUBAGENT_TOOL_LABELS, SUBAGENT_WRITE_TOOL_IDS } from '../../shared/subagent'
import {
  draftToSubAgent,
  draftWriteHasNoTools,
  emptySubAgentDraft,
  subAgentToDraft,
  SUBAGENT_DESCRIPTION_MAX,
  SUBAGENT_NAME_MAX,
  SUBAGENT_PROMPT_MAX,
  upsertSubAgent,
  validateSubAgentDraft,
  type SubAgentDraft
} from './subagent-draft'

const THINKING_LEVELS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' }
]

/** 总开关在 PermissionSettings 里，这里只管自定义角色本身。 */
export function SubAgentSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const [draft, setDraft] = useState<SubAgentDraft>(emptySubAgentDraft)
  // 正在编辑的原角色 id；null 表示新建。改了 id 保存时要把原条目换掉，不能靠 draft.id 判断。
  const [editingId, setEditingId] = useState<string | null>(null)
  // 没动过的表单不亮红字，点过保存或改过对应字段才提示
  const [touched, setTouched] = useState<Set<keyof SubAgentDraft>>(() => new Set())
  const [submitted, setSubmitted] = useState(false)
  const agents = useMemo(() => settings.subAgents ?? [], [settings.subAgents])
  const errors = validateSubAgentDraft(draft, agents, editingId)
  const canSave = Object.keys(errors).length === 0
  const showError = (key: keyof typeof errors) => (submitted || touched.has(key)) ? errors[key] : undefined

  const updateDraft = <K extends keyof SubAgentDraft>(key: K, value: SubAgentDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setTouched((current) => current.has(key) ? current : new Set(current).add(key))
  }
  // 关掉写入时同步裁掉已勾的写类工具：留着它们会让保存后的角色和界面显示对不上。
  const setAllowWrite = (allowWrite: boolean) => setDraft((current) => ({
    ...current,
    allowWrite,
    tools: allowWrite ? current.tools : current.tools.filter((tool) => !isSubAgentWriteTool(tool))
  }))
  const toggleTool = (tool: string) => setDraft((current) => ({
    ...current,
    tools: current.tools.includes(tool) ? current.tools.filter((item) => item !== tool) : [...current.tools, tool]
  }))
  const reset = () => {
    setDraft(emptySubAgentDraft())
    setEditingId(null)
    setTouched(new Set())
    setSubmitted(false)
  }
  const edit = (agent: NonNullable<AppSettings['subAgents']>[number]) => {
    setDraft(subAgentToDraft(agent))
    setEditingId(agent.id)
    setTouched(new Set())
    setSubmitted(false)
  }
  const save = () => {
    setSubmitted(true)
    if (!canSave) return
    onChange({ subAgents: upsertSubAgent(agents, draftToSubAgent(draft), editingId) })
    reset()
  }
  const remove = (id: string) => {
    onChange({ subAgents: agents.filter((agent) => agent.id !== id) })
    if (editingId === id) reset()
  }
  const idError = showError('id')
  const nameError = showError('name')
  const promptError = showError('systemPrompt')
  const maxToolCallsError = showError('maxToolCalls')

  return <div className="subagent-settings">
    <p className="settings-hint subagent-intro">内置 scout、reviewer、builder、verifier 之外的角色。描述会写进主 Agent 看到的可委派清单，写清楚这个角色什么时候该被用到。授予写入后，子任务的文件与命令操作仍按当前会话的权限档位请求批准，可与其他子任务并行；并行子任务写同一文件时，后写入的一方会被拒绝。</p>

    {agents.length === 0
      ? <div className="subagent-empty"><Bot size={16} />还没有自定义角色，在下方填写后保存即可创建</div>
      : <ul className="subagent-list">
        {agents.map((agent) => <li key={agent.id} className={`subagent-card${editingId === agent.id ? ' editing' : ''}`}>
          <div className="subagent-card-copy">
            <div className="subagent-card-title">
              <strong>{agent.name}</strong>
              <code>{agent.id}</code>
              <span className={`settings-badge${agent.allowWrite ? '' : ' muted'}`}>{agent.allowWrite ? '可写' : '只读'}</span>
              {agent.allowMcp && <span className="settings-badge muted">MCP</span>}
            </div>
            {agent.description && <small>{agent.description}</small>}
          </div>
          <div className="subagent-card-actions">
            <button type="button" className="icon-button" onClick={() => edit(agent)} aria-label={`编辑 ${agent.name}`} title="编辑"><Pencil size={13} /></button>
            <button type="button" className="icon-button" onClick={() => remove(agent.id)} aria-label={`删除 ${agent.name}`} title="删除"><Trash2 size={13} /></button>
          </div>
        </li>)}
      </ul>}

    <div className="subagent-editor">
      <div className="subagent-editor-head">
        <strong>{editingId ? `编辑「${agents.find((agent) => agent.id === editingId)?.name ?? editingId}」` : '新建角色'}</strong>
        {editingId && <button type="button" className="quick-secondary" onClick={reset}><Plus size={12} />改为新建</button>}
      </div>

      <div className="subagent-editor-section">
        <div className="subagent-field-grid">
          <label className={`settings-inline-field${idError ? ' invalid' : ''}`}>
            <span>ID</span>
            <input value={draft.id} onChange={(event) => updateDraft('id', event.target.value.trim())} placeholder="api-reviewer" spellCheck={false} aria-invalid={Boolean(idError)} />
            {idError && <small className="subagent-field-error">{idError}</small>}
          </label>
          <label className={`settings-inline-field${nameError ? ' invalid' : ''}`}>
            <span>名称</span>
            <input value={draft.name} maxLength={SUBAGENT_NAME_MAX} onChange={(event) => updateDraft('name', event.target.value)} placeholder="API 审查员" aria-invalid={Boolean(nameError)} />
            {nameError && <small className="subagent-field-error">{nameError}</small>}
          </label>
          <label className="settings-inline-field subagent-field-wide">
            <span>用途描述</span>
            <input value={draft.description} maxLength={SUBAGENT_DESCRIPTION_MAX} onChange={(event) => updateDraft('description', event.target.value)} placeholder="只读检查 API 契约与调用方兼容性" />
          </label>
          <label className={`settings-inline-field subagent-field-wide${promptError ? ' invalid' : ''}`}>
            <span>系统指令<em>{draft.systemPrompt.length} / {SUBAGENT_PROMPT_MAX}</em></span>
            <textarea rows={5} value={draft.systemPrompt} maxLength={SUBAGENT_PROMPT_MAX} onChange={(event) => updateDraft('systemPrompt', event.target.value)} placeholder="只阅读并分析 API 相关代码，不修改文件。" aria-invalid={Boolean(promptError)} />
            {promptError && <small className="subagent-field-error">{promptError}</small>}
          </label>
          <div className="settings-inline-field">
            <span>思考级别</span>
            <div className="settings-segmented subagent-thinking" role="group" aria-label="思考级别">
              {THINKING_LEVELS.map((level) => <button key={level.value} type="button" className={draft.thinkingLevel === level.value ? 'active' : ''} aria-pressed={draft.thinkingLevel === level.value} onClick={() => updateDraft('thinkingLevel', level.value)}>{level.label}</button>)}
            </div>
          </div>
          <label className={`settings-inline-field${maxToolCallsError ? ' invalid' : ''}`}>
            <span>工具调用上限</span>
            <input
              type="number"
              min={1}
              max={SUBAGENT_MAX_TOOL_CALLS_CEILING}
              step={1}
              value={draft.maxToolCalls}
              placeholder={`留空跟随全局（${SUBAGENT_DEFAULT_MAX_TOOL_CALLS}）`}
              onChange={(event) => updateDraft('maxToolCalls', event.target.value === '' ? '' : Number(event.target.value))}
              aria-invalid={Boolean(maxToolCallsError)}
            />
            {maxToolCallsError && <small className="subagent-field-error">{maxToolCallsError}</small>}
          </label>
        </div>
      </div>

      <div className="subagent-editor-section">
        <h4>权限</h4>
        <label className="switch-row subagent-switch">
          <input type="checkbox" checked={draft.allowWrite} onChange={(event) => setAllowWrite(event.target.checked)} />
          <span className="switch-visual" />
          <span><strong>允许修改文件与执行命令</strong><small>关闭时该角色强制运行在计划模式，写类工具会被直接拒绝</small></span>
        </label>
        <label className="switch-row subagent-switch">
          <input type="checkbox" checked={draft.allowMcp} onChange={(event) => updateDraft('allowMcp', event.target.checked)} />
          <span className="switch-visual" />
          <span><strong>允许使用 MCP 工具</strong><small>复用当前会话已连接的 MCP Server，不额外建立连接</small></span>
        </label>
      </div>

      <div className="subagent-editor-section">
        <h4>可用工具</h4>
        <div className="subagent-tool-group">
          <span className="subagent-tool-group-label">只读<small>始终可用</small></span>
          <div className="subagent-tool-chips">
            {SUBAGENT_READONLY_TOOL_IDS.map((tool) => <span key={tool} className="subagent-tool-chip on locked" title="只读工具始终授予：连代码都读不了的角色拿到任务也只能瞎猜">{SUBAGENT_TOOL_LABELS[tool]}<code>{tool}</code></span>)}
          </div>
        </div>
        <div className="subagent-tool-group">
          <span className="subagent-tool-group-label">写入<small>{draft.allowWrite ? '按需勾选' : '需先允许修改'}</small></span>
          <div className="subagent-tool-chips">
            {SUBAGENT_WRITE_TOOL_IDS.map((tool) => {
              const on = draft.allowWrite && draft.tools.includes(tool)
              return <button
                key={tool}
                type="button"
                className={`subagent-tool-chip${on ? ' on' : ''}`}
                disabled={!draft.allowWrite}
                aria-pressed={on}
                onClick={() => toggleTool(tool)}
              >{SUBAGENT_TOOL_LABELS[tool]}<code>{tool}</code></button>
            })}
          </div>
        </div>
        {draftWriteHasNoTools(draft) && <small className="settings-hint subagent-warning">已允许修改，但还没勾选任何写入工具，这个角色实际仍按只读运行。</small>}
        <small className="settings-hint">待办、提问与后台命令不开放给子 Agent。</small>
      </div>

      <div className="subagent-editor-actions">
        {editingId && <button type="button" className="quick-secondary" onClick={reset}>取消</button>}
        <button type="button" className="quick-primary" onClick={save} disabled={submitted && !canSave}>{editingId ? '保存修改' : '创建 Sub-agent'}</button>
      </div>
    </div>
  </div>
}
