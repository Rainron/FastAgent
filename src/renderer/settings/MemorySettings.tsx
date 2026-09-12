import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import type { AppSettings, MemoryRecord, MemoryType, ModelOption, PageResult, ProjectRecord } from '../../shared/types'
import { DEFAULT_PAGE_SIZE } from '../../shared/pagination'
import { Pagination } from '../components/Pagination'
import { describeMemoryClearTarget, describeMemoryScope, memoryClearTarget, memoryExtractModelChoices, memoryListQuery, type MemoryScopeFilter } from './memory-filter'

const TYPE_LABEL: Record<MemoryType, string> = { preference: '偏好', fact: '事实', decision: '决定', experience: '经验' }

const EMPTY_PAGE: PageResult<MemoryRecord> = { items: [], total: 0, page: 1, pageSize: DEFAULT_PAGE_SIZE }

function formatTime(value: number): string {
  return new Date(value).toLocaleString()
}

export function MemorySettings({ settings, models, onChange, onNotice }: {
  settings: AppSettings
  models: ModelOption[]
  onChange: (patch: Partial<AppSettings>) => void
  onNotice: (notice: string) => void
}) {
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [filter, setFilter] = useState<MemoryScopeFilter>({ kind: 'all' })
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [data, setData] = useState<PageResult<MemoryRecord>>(EMPTY_PAGE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // 原生 confirm 关闭后不把焦点还给 webContents，改用两段式确认。
  const [confirmingClear, setConfirmingClear] = useState(false)

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.name])), [projects])
  const extractModelChoices = useMemo(() => memoryExtractModelChoices(models, settings.memory.extractModelId), [models, settings.memory.extractModelId])

  const load = useCallback(() => {
    void window.fastAgent.memories.list(memoryListQuery(filter, page, pageSize, keyword))
      .then(setData)
      .catch(() => onNotice('记忆列表加载失败'))
  }, [filter, page, pageSize, keyword, onNotice])

  useEffect(() => { void window.fastAgent.projects.list().then(setProjects).catch(() => undefined) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => window.fastAgent.memories.onChanged(() => load()), [load])

  const changeFilter = (value: string) => {
    setPage(1)
    setConfirmingClear(false)
    setFilter(value === 'all' ? { kind: 'all' } : value === 'global' ? { kind: 'global' } : { kind: 'project', projectId: value })
  }

  const startEdit = (memory: MemoryRecord) => {
    setEditingId(memory.id)
    setDraft(memory.content)
  }

  const saveEdit = async () => {
    const content = draft.trim()
    if (!editingId || !content) return
    try {
      await window.fastAgent.memories.update(editingId, { content })
      setEditingId(null)
      load()
    } catch {
      onNotice('记忆保存失败')
    }
  }

  const remove = async (id: string) => {
    try {
      await window.fastAgent.memories.remove(id)
      load()
    } catch {
      onNotice('记忆删除失败')
    }
  }

  const clear = async () => {
    const target = memoryClearTarget(filter)
    try {
      const removed = await window.fastAgent.memories.clear(target.scope, target.scopeId)
      setConfirmingClear(false)
      setPage(1)
      load()
      onNotice(`已清空 ${removed} 条记忆`)
    } catch {
      onNotice('清空记忆失败')
    }
  }

  const selected = filter.kind === 'project' ? filter.projectId : filter.kind
  const clearLabel = describeMemoryClearTarget(filter, filter.kind === 'project' ? projectNames[filter.projectId] : undefined)

  return <section className="settings-panel" aria-labelledby="settings-memory">
    <div className="settings-section-heading">
      <div><h2 id="settings-memory">记忆</h2><p>跨会话保存的长期信息。召回按「当前项目 + 全局」过滤，未归属项目的会话只使用全局记忆。</p></div>
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
        value={settings.memory.maxRecall}
        disabled={!settings.memory.enabled}
        onChange={(event) => onChange({ memory: { ...settings.memory, maxRecall: Number(event.target.value) } })}
      />
    </div>
    <div className="settings-form-grid">
      <label className="settings-inline-field">
        <span>作用域</span>
        <select value={selected} onChange={(event) => changeFilter(event.target.value)}>
          <option value="all">全部</option>
          <option value="global">全局</option>
          {projects.map((project) => <option key={project.id} value={project.id}>项目 · {project.name}</option>)}
        </select>
      </label>
      <label className="settings-inline-field">
        <span>搜索</span>
        <input value={keyword} onChange={(event) => { setPage(1); setKeyword(event.target.value) }} placeholder="按内容筛选" />
      </label>
    </div>
    {data.items.length === 0
      ? <div className="section-list-empty">还没有记忆</div>
      : data.items.map((memory) => <div className="settings-row settings-row-stack" key={memory.id}>
          <div>
            {editingId === memory.id
              ? <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />
              : <strong>{memory.content}</strong>}
            <span>{TYPE_LABEL[memory.type]} · {describeMemoryScope(memory, projectNames)} · 更新于 {formatTime(memory.updatedAt)}</span>
            <small>{memory.sourceConversationId ? `来源会话 ${memory.sourceConversationId}` : '手动添加'}</small>
          </div>
          <div className="model-settings-actions">
            {editingId === memory.id
              ? <>
                  <button className="small-control" onClick={() => void saveEdit()}><Check size={13} />保存</button>
                  <button className="small-control" onClick={() => setEditingId(null)}><X size={13} />取消</button>
                </>
              : <>
                  <button className="small-control" onClick={() => startEdit(memory)}><Pencil size={13} />编辑</button>
                  <button className="small-control" onClick={() => void remove(memory.id)}><Trash2 size={13} />删除</button>
                </>}
          </div>
        </div>)}
    <Pagination
      page={data.page}
      pageSize={data.pageSize}
      total={data.total}
      onPageChange={setPage}
      onPageSizeChange={(size) => { setPage(1); setPageSize(size) }}
    />
    <div className="settings-row">
      <div><strong>清空记忆</strong><span>将删除{clearLabel}，不可恢复</span></div>
      {confirmingClear
        ? <div className="model-settings-actions">
            <button className="quick-primary" onClick={() => void clear()}>确认清空</button>
            <button className="quick-secondary" onClick={() => setConfirmingClear(false)}>取消</button>
          </div>
        : <button className="quick-secondary" onClick={() => setConfirmingClear(true)}>清空</button>}
    </div>
  </section>
}
