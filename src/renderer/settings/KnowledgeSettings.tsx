import { useEffect, useMemo, useState } from 'react'
import { FileText, FolderPlus, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, Unlink } from 'lucide-react'
import type { KbEntry, KbSource, KbSourceKind, KbSourcePreview, ProjectRecord } from '../../shared/types'
import { describeIndexResult, describePreview, describeSource, entryOrigin, sourceStatusLabel, sourceStatusTone } from './kb-source-view'

interface Draft { id?: string; title: string; content: string }
const EMPTY_DRAFT: Draft = { title: '', content: '' }

/**
 * 项目知识库管理：左列表右详情的 master-detail 布局。
 * 编辑态由「编辑 / 新增」显式进入，切换条目即放弃未保存草稿——
 * 知识条目是人工策展内容，静默丢弃前有可见的取消按钮兜底。
 */
export function KnowledgeSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null)
  const [projectId, setProjectId] = useState('')
  const [entries, setEntries] = useState<KbEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [sources, setSources] = useState<KbSource[]>([])
  // 待确认的导入：选完路径先看范围预览，用户点确认才真正建来源并写库。
  const [pending, setPending] = useState<KbSourcePreview | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.fastAgent.projects.list()
      .then((list) => {
        const active = list.filter((project) => !project.archived)
        setProjects(active)
        setProjectId((current) => current || active[0]?.id || '')
      })
      .catch(() => onNotice('项目列表加载失败'))
  }, [onNotice])

  useEffect(() => {
    if (!projectId) { setEntries([]); setSources([]); setSelectedId(null); return }
    let cancelled = false
    void window.fastAgent.knowledgeBase.list(projectId)
      .then((list) => {
        if (cancelled) return
        setEntries(list)
        setSelectedId((current) => (list.some((entry) => entry.id === current) ? current : list[0]?.id ?? null))
      })
      .catch(() => { if (!cancelled) onNotice('知识条目加载失败') })
    void window.fastAgent.knowledgeBase.listSources(projectId)
      .then((list) => { if (!cancelled) setSources(list) })
      .catch(() => { if (!cancelled) onNotice('知识来源加载失败') })
    return () => { cancelled = true }
  }, [projectId, onNotice])

  // 其他窗口/入口改了知识库时刷新当前列表
  useEffect(() => window.fastAgent.knowledgeBase.onChanged((changed) => {
    if (changed !== projectId) return
    void window.fastAgent.knowledgeBase.list(projectId).then(setEntries).catch(() => undefined)
    void window.fastAgent.knowledgeBase.listSources(projectId).then(setSources).catch(() => undefined)
  }), [projectId])

  // 列表加载后草稿可能指向已不存在的条目，编辑态随之失效
  const selected = useMemo(() => entries.find((entry) => entry.id === selectedId) ?? null, [entries, selectedId])

  async function save() {
    if (!draft || !projectId) return
    setSaving(true)
    try {
      const saved = await window.fastAgent.knowledgeBase.save(projectId, draft)
      const list = await window.fastAgent.knowledgeBase.list(projectId)
      setEntries(list)
      setSelectedId(saved.id)
      setDraft(null)
      onNotice(draft.id ? '知识条目已更新' : '知识条目已保存')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '知识条目保存失败')
    } finally { setSaving(false) }
  }

  async function remove(entryId: string) {
    try {
      await window.fastAgent.knowledgeBase.remove(projectId, entryId)
      const list = await window.fastAgent.knowledgeBase.list(projectId)
      setEntries(list)
      setSelectedId(list[0]?.id ?? null)
      setDraft(null)
      setConfirmingDelete(false)
      onNotice('知识条目已删除')
    } catch { onNotice('知识条目删除失败') }
  }

  async function pickSource(kind: KbSourceKind) {
    try {
      const preview = await window.fastAgent.knowledgeBase.pickSource(kind)
      if (preview) setPending(preview)
    } catch (error) { onNotice(error instanceof Error ? error.message : '选择来源失败') }
  }

  async function confirmImport() {
    if (!pending || !projectId) return
    setBusy(true)
    try {
      const result = await window.fastAgent.knowledgeBase.addSource(projectId, { path: pending.path, kind: pending.kind })
      setPending(null)
      onNotice(describeIndexResult(result))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '导入失败')
    } finally { setBusy(false) }
  }

  async function refreshSource(sourceId: string) {
    setBusy(true)
    try { onNotice(describeIndexResult(await window.fastAgent.knowledgeBase.refreshSource(sourceId))) }
    catch (error) { onNotice(error instanceof Error ? error.message : '重新索引失败') }
    finally { setBusy(false) }
  }

  async function removeSource(sourceId: string) {
    try {
      await window.fastAgent.knowledgeBase.removeSource(sourceId)
      onNotice('已解绑来源，其条目已删除')
    } catch { onNotice('解绑来源失败') }
  }

  function pick(entryId: string) {
    // 有未保存草稿时切走即放弃：取消按钮就是显式的退出通道，弹窗确认反而打断节奏。
    setDraft(null)
    setConfirmingDelete(false)
    setSelectedId(entryId)
  }

  return <section className="settings-panel" aria-labelledby="settings-knowledge">
    <div className="settings-section-heading">
      <div><h2 id="settings-knowledge">项目知识库</h2><p>人工维护的项目约定与背景；对话时按相关性自动注入该项目下的会话。</p></div>
      {projects && projects.length > 0 && <div className="model-settings-actions">
        <select className="kb-project-select" value={projectId} onChange={(event) => { setProjectId(event.target.value); setDraft(null) }} aria-label="选择项目">
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button className="small-control" disabled={busy} onClick={() => void pickSource('file')}><FileText size={13} />导入文件</button>
        <button className="small-control" disabled={busy} onClick={() => void pickSource('directory')}><FolderPlus size={13} />绑定目录</button>
        <button className="small-control primary" onClick={() => { setDraft({ ...EMPTY_DRAFT }); setConfirmingDelete(false) }}><Plus size={13} />新增条目</button>
      </div>}
    </div>
    {pending && <div className="kb-import-preview">
      <div className="kb-import-head">
        <strong>{pending.path}</strong>
        <span>{describePreview(pending)}</span>
      </div>
      {pending.skipped.length > 0 && <ul className="kb-import-skipped">
        {pending.skipped.map((group) => <li key={group.reason}>{group.label}：{group.count}</li>)}
      </ul>}
      <div className="model-settings-actions">
        <button className="small-control" onClick={() => setPending(null)}>取消</button>
        <button className="small-control primary" disabled={busy || pending.files.length === 0} onClick={() => void confirmImport()}>{busy ? '索引中' : '确认导入'}</button>
      </div>
    </div>}
    {sources.length > 0 && <div className="kb-sources">
      {sources.map((source) => <div className={`kb-source-row ${sourceStatusTone(source)}`} key={source.id}>
        <div className="kb-source-main">
          <strong title={source.path}>{source.title}</strong>
          <span>{describeSource(source)}</span>
          {source.error && <em className="kb-source-error">{source.error}</em>}
        </div>
        <span className="kb-source-status">{sourceStatusLabel(source)}</span>
        <button className="small-control" disabled={busy} onClick={() => void refreshSource(source.id)} title="重新索引"><RefreshCw size={13} /></button>
        <button className="small-control" onClick={() => void removeSource(source.id)} title="解绑并删除其条目"><Unlink size={13} /></button>
      </div>)}
    </div>}
    {!projects ? <div className="section-list-empty"><LoaderCircle size={18} className="spin" /> 加载中</div>
      : projects.length === 0 ? <div className="section-list-empty">先在侧栏添加一个项目，再为它沉淀知识</div>
      : <div className="kb-layout">
        <div className="kb-list" role="listbox" aria-label="知识条目列表">
          {entries.length === 0 && <div className="kb-list-empty">还没有条目</div>}
          {entries.map((entry) => <button key={entry.id} role="option" aria-selected={selectedId === entry.id} className={`kb-item ${selectedId === entry.id ? 'active' : ''}`} onClick={() => pick(entry.id)}>
            <strong>{entry.title}</strong>
            <span>{entry.content.replace(/\s+/g, ' ').slice(0, 60)}</span>
            <small>{entryOrigin(entry) || new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</small>
          </button>)}
        </div>
        <div className="kb-detail">
          {draft ? <div className="kb-editor">
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="标题，如：发布流程" aria-label="标题" />
            <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="内容：约定、背景、流程说明……对话相关时会自动注入" aria-label="内容" rows={12} />
            <div className="model-settings-actions">
              <button className="small-control" onClick={() => setDraft(null)}>取消</button>
              <button className="small-control primary" disabled={!draft.title.trim() || !draft.content.trim() || saving} onClick={() => void save()}>{saving ? '保存中' : '保存'}</button>
            </div>
          </div>
          : selected ? <>
            <div className="kb-detail-header">
              <div><strong>{selected.title}</strong><small>{entryOrigin(selected) ? `${entryOrigin(selected)} · ` : ''}更新于 {new Date(selected.updatedAt).toLocaleString('zh-CN')}</small></div>
              <div className="model-settings-actions">
                {/* 导入条目下一次重新索引会被整份替换，就地编辑等于白改，因此只允许改手工条目 */}
                {!selected.sourceId && <button className="small-control" onClick={() => { setDraft({ id: selected.id, title: selected.title, content: selected.content }); setConfirmingDelete(false) }}><Pencil size={13} />编辑</button>}
                {confirmingDelete
                  ? <>
                    <button className="small-control" onClick={() => setConfirmingDelete(false)}>不删</button>
                    <button className="small-control danger" onClick={() => void remove(selected.id)}>确认删除</button>
                  </>
                  : <button className="small-control" onClick={() => setConfirmingDelete(true)}><Trash2 size={13} />删除</button>}
              </div>
            </div>
            <div className="kb-detail-content">{selected.content}</div>
          </>
          : <div className="kb-detail-empty"><FileText size={22} /><p>{entries.length === 0 ? '把常用约定、架构说明贴进来；检索按标题与正文分词匹配，中文无需手动分词。' : '从左侧选择一个条目查看'}</p></div>}
        </div>
      </div>}
  </section>
}
