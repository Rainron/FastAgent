import { useMemorySettings } from './hooks/use-memory-settings'
import { Pencil, Trash2 } from 'lucide-react'
import type { AppSettings, MemoryType, ModelOption } from '../../shared/types'
import { CenterDialog } from '../components/CenterDialog'
import { Pagination } from '../components/Pagination'
import { describeMemoryScope } from './memory-filter'

const TYPE_LABEL: Record<MemoryType, string> = { preference: '偏好', fact: '事实', decision: '决定', experience: '经验' }


function formatTime(value: number): string {
  return new Date(value).toLocaleString()
}

export function MemorySettings({ settings, models, onChange, onNotice }: {
  settings: AppSettings
  models: ModelOption[]
  onChange: (patch: Partial<AppSettings>) => void
  onNotice: (notice: string) => void
}) {
  const { busy, projects, keyword, setKeyword, setPage, setPageSize, data, editingId, setEditingId, draft, setDraft, confirmingClear, setConfirmingClear, projectNames, extractModelChoices, changeFilter, startEdit, saveEdit, remove, clear, selected, clearLabel, loading, error, load } = useMemorySettings(settings, models, onNotice)

  return <fieldset className="settings-editable" disabled={busy}><section className="settings-panel" aria-labelledby="settings-memory">
    <div className="settings-section-heading">
      <div><h2 id="settings-memory">记忆策略</h2><p>控制哪些信息进入长期记忆，以及每轮对话注入多少条。</p></div>
    </div>
    <div className="settings-stat-grid">
      <div className="settings-stat"><span>已保存记忆 · 当前筛选</span><strong>{loading ? '—' : data.total}</strong><small>{clearLabel}</small></div>
      <div className="settings-stat"><span>自动提取</span><strong>{settings.memory.enabled && settings.memory.autoExtract ? '已开启' : '已关闭'}</strong><small>每轮结束后判断长期信息</small></div>
      <div className="settings-stat"><span>单轮注入</span><strong>{settings.memory.maxRecall}</strong><small>每轮最多召回条数</small></div>
    </div>
    <label className="switch-row">
      <input type="checkbox" checked={settings.memory.enabled} onChange={(event) => onChange({ memory: { ...settings.memory, enabled: event.target.checked } })} />
      <span className="switch-visual" />
      <span><strong>启用跨会话记忆</strong><small>关闭后既不召回也不新增记忆，已保存内容保留</small></span>
    </label>
    <label className="switch-row">
      <input type="checkbox" disabled={!settings.memory.enabled} checked={settings.memory.autoExtract} onChange={(event) => onChange({ memory: { ...settings.memory, autoExtract: event.target.checked } })} />
      <span className="switch-visual" />
      <span><strong>自动提取记忆</strong><small>每轮结束后额外调用一次模型判断是否有值得长期保存的信息</small></span>
    </label>
    <div className="settings-row">
      <div><strong>提取模型</strong><span>抽取只是一次性判断，可以选比会话模型更便宜的；所选模型失效时自动回落到会话模型</span></div>
      <select
        value={settings.memory.extractModelId === null ? '' : String(settings.memory.extractModelId)}
        disabled={!settings.memory.enabled || !settings.memory.autoExtract}
        onChange={(event) => onChange({ memory: { ...settings.memory, extractModelId: event.target.value === '' ? null : Number(event.target.value) } })}
      >
        <option value="">跟随会话模型</option>
        {extractModelChoices.map((choice) => <option key={choice.id} value={String(choice.id)}>{choice.label}</option>)}
      </select>
    </div>
    <div className="settings-row">
      <div><strong>单轮注入条数</strong><span>召回上限，越大占用上下文越多</span></div>
      <input
        type="number"
        min={3}
        max={8}
        aria-label="单轮注入条数"
        value={settings.memory.maxRecall}
        disabled={!settings.memory.enabled}
        onChange={(event) => onChange({ memory: { ...settings.memory, maxRecall: Math.max(3, Math.min(8, Number(event.target.value) || 3)) } })}
      />
    </div>
  </section>
  <section className="settings-panel" aria-labelledby="saved-memories">
    <div className="settings-section-heading"><div><h2 id="saved-memories">已保存的记忆</h2><p>按作用域筛选与搜索；修改会影响后续对话。</p></div><button className="quick-secondary" onClick={() => setConfirmingClear(true)}>清空记忆</button></div>
    <div className="memory-toolbar">
      <select value={selected} onChange={(event) => changeFilter(event.target.value)} aria-label="记忆作用域"><option value="all">全部</option><option value="global">全局</option>{projects.map((project) => <option key={project.id} value={project.id}>项目 · {project.name}</option>)}</select>
      <input value={keyword} onChange={(event) => { setPage(1); setKeyword(event.target.value) }} placeholder="搜索记忆内容" aria-label="搜索记忆内容" />
    </div>
    {error ? <div className="section-list-empty" role="alert">{error}<button className="small-control" onClick={load}>重试</button></div> : loading ? <div className="section-list-empty" role="status">加载中…</div> : <div className="memory-table">
      <div className="memory-table-head"><span>内容</span><span>类型</span><span>作用域</span><span>操作</span></div>
      {data.items.length === 0 ? <div className="section-list-empty">{keyword ? '没有匹配的记忆' : '当前作用域还没有记忆'}</div> : data.items.map((memory) => <div className="memory-table-row" key={memory.id}>
        <div><strong>{memory.content}</strong><small>更新于 {formatTime(memory.updatedAt)} · {memory.sourceConversationId ? `来源：对话 ${memory.sourceConversationId}` : '手动添加'}</small></div>
        <span className="settings-badge">{TYPE_LABEL[memory.type]}</span><span className="settings-badge muted" title={describeMemoryScope(memory, projectNames)}>{describeMemoryScope(memory, projectNames)}</span>
        <div className="model-settings-actions"><button className="small-control" onClick={() => startEdit(memory)}>编辑</button><button className="small-control" onClick={() => void remove(memory.id)} aria-label={`删除记忆：${memory.content}`}><Trash2 size={12} /></button></div>
      </div>)}
    </div>}
    <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} onPageSizeChange={(size) => { setPage(1); setPageSize(size) }} />
    {editingId && <CenterDialog busy={busy} title="编辑记忆" subtitle="修改后会影响后续相关对话的召回结果" icon={<Pencil size={16} />} onClose={() => setEditingId(null)} footer={<><button className="approval-secondary" onClick={() => setEditingId(null)}>取消</button><button className="approval-primary" disabled={!draft.trim()} onClick={() => void saveEdit()}>保存记忆</button></>}><label className="settings-inline-field"><span>记忆内容</span><textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} /></label></CenterDialog>}
    {confirmingClear && <CenterDialog busy={busy} title="清空记忆？" subtitle="此操作不可撤销，请确认删除范围" onClose={() => setConfirmingClear(false)} footer={<><button className="approval-secondary" onClick={() => setConfirmingClear(false)}>取消</button><button className="approval-primary" onClick={() => void clear()}>确认清空</button></>}><p>将永久删除{clearLabel}。搜索关键词不会缩小删除范围，对话记录不受影响。</p></CenterDialog>}
  </section></fieldset>
}
