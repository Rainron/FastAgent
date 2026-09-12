import { useMemo, useState } from 'react'
import type { AppSettings } from '../../shared/types'

const DEFAULT_AGENT = { id: '', name: '', description: '', systemPrompt: '', thinkingLevel: 'low' as const, maxTurns: 8 }

/** 总开关在 PermissionSettings 里，这里只管自定义角色本身。 */
export function SubAgentSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const [draft, setDraft] = useState(DEFAULT_AGENT)
  const agents = useMemo(() => settings.subAgents ?? [], [settings.subAgents])
  const updateDraft = (key: keyof typeof DEFAULT_AGENT, value: string | number) => setDraft((current) => ({ ...current, [key]: value }))
  // id 是模型委派时唯一的标识，格式与主进程 normalizeCustomSubAgents 保持一致，否则存了也用不上。
  const idValid = /^[a-z][a-z0-9_-]{1,31}$/.test(draft.id) && draft.id !== 'scout' && draft.id !== 'reviewer'
  const canSave = idValid && Boolean(draft.name.trim()) && Boolean(draft.systemPrompt.trim())
  const save = () => {
    if (!canSave) return
    onChange({ subAgents: [...agents.filter((agent) => agent.id !== draft.id), { ...draft, name: draft.name.trim(), description: draft.description.trim(), systemPrompt: draft.systemPrompt.trim() }] })
    setDraft(DEFAULT_AGENT)
  }
  const remove = (id: string) => onChange({ subAgents: agents.filter((agent) => agent.id !== id) })
  return <>
    <div className="settings-section-heading" style={{ marginTop: 14 }}>
      <div><h2>自定义 Sub-agent</h2><p>内置 scout、reviewer 之外的只读角色。描述会写进主 Agent 看到的可委派清单，写清楚这个角色什么时候该被用到。当前阶段不允许写文件、Shell、MCP 或递归委派。</p></div>
    </div>
    {agents.map((agent) => <div className="settings-row" key={agent.id}>
      <div><strong>{agent.name}</strong><span>{agent.id}{agent.description ? ` · ${agent.description}` : ''}</span></div>
      <button className="quick-secondary" onClick={() => remove(agent.id)}>删除</button>
    </div>)}
    {agents.length === 0 && <div className="section-list-empty">还没有自定义角色</div>}
    <div className="settings-form-grid">
      <label className="settings-inline-field"><span>ID</span><input value={draft.id} onChange={(event) => updateDraft('id', event.target.value)} placeholder="api-reviewer" /></label>
      <label className="settings-inline-field"><span>名称</span><input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="API 审查员" /></label>
      <label className="settings-inline-field"><span>用途描述</span><input value={draft.description} onChange={(event) => updateDraft('description', event.target.value)} placeholder="只读检查 API 契约与调用方兼容性" /></label>
      <label className="settings-inline-field"><span>系统指令</span><textarea rows={5} value={draft.systemPrompt} onChange={(event) => updateDraft('systemPrompt', event.target.value)} placeholder="只阅读并分析 API 相关代码，不修改文件。" /></label>
    </div>
    <button className="quick-primary" onClick={save} disabled={!canSave}>保存只读 Agent</button>
    {draft.id && !idValid && <small className="settings-hint">ID 只能用小写字母开头的 2~32 位字母、数字、下划线或短横线，且不能占用 scout / reviewer。</small>}
  </>
}
