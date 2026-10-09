import { useKnowledgeSettings } from './hooks/use-knowledge-settings'
import { MarkdownRenderer } from '../resource-panel/MarkdownRenderer'
import { FileText, FolderPlus, LoaderCircle, Pencil, Plus, RefreshCw, Trash2, Unlink } from 'lucide-react'
import { CenterDialog } from '../components/CenterDialog'
import { describePreview, describeSource, entryOrigin, sourceStatusLabel, sourceStatusTone } from './kb-source-view'

interface Draft { id?: string; title: string; content: string }
const EMPTY_DRAFT: Draft = { title: '', content: '' }

/**
 * 项目知识库管理：左列表右详情的 master-detail 布局。
 * 编辑态由「编辑 / 新增」显式进入，切换条目即放弃未保存草稿——
 * 知识条目是人工策展内容，静默丢弃前有可见的取消按钮兜底。
 */
export function KnowledgeSettings({ onNotice }: { onNotice: (notice: string) => void }) {
  const { loading, error, reload, projects, projectId, setProjectId, entries, selectedId, draft, setDraft, saving, confirmingDelete, setConfirmingDelete, sources, pending, setPending, busy, selected, save, remove, pickSource, confirmImport, refreshSource, removeSource, pick } = useKnowledgeSettings(onNotice)

  return <section className="settings-panel" aria-labelledby="settings-knowledge">
    <div className="settings-section-heading">
      <div><h2 id="settings-knowledge">{projects?.find((project) => project.id === projectId)?.name ?? '项目知识库'}</h2><p>{entries.length} 个条目 · {sources.length} 个来源 · 按相关性召回</p></div>
      {projects && projects.length > 0 && <div className="model-settings-actions">
        <select className="kb-project-select" disabled={busy || saving || loading} value={projectId} onChange={(event) => { setProjectId(event.target.value); setDraft(null) }} aria-label="选择项目">
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button className="small-control" disabled={busy} onClick={() => void pickSource('file')}><FileText size={13} />导入文件</button>
        <button className="small-control" disabled={busy} onClick={() => void pickSource('directory')}><FolderPlus size={13} />绑定目录</button>
        <button className="small-control primary" disabled={busy || loading} onClick={() => { setDraft({ ...EMPTY_DRAFT }); setConfirmingDelete(false) }}><Plus size={13} />新增条目</button>
      </div>}
    </div>
    {pending && <CenterDialog title="导入知识来源" subtitle="确认文件范围后开始解析与索引" busy={busy} onClose={() => setPending(null)}><div className="kb-import-preview">
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
    </div></CenterDialog>}
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
    {error ? <div className="section-list-empty" role="alert">{error}<button className="small-control" onClick={reload}>重试</button></div> : !projects || loading ? <div className="section-list-empty"><LoaderCircle size={18} className="spin" /> 加载中</div>
      : projects.length === 0 ? <div className="section-list-empty">先在侧栏添加一个项目，再为它沉淀知识</div>
      : <div className="kb-layout">
        <div className="kb-list" role="listbox" aria-label="知识条目列表">
          {entries.length === 0 && <div className="kb-list-empty">还没有条目</div>}
          {entries.map((entry) => <button key={entry.id} role="option" aria-selected={selectedId === entry.id} className={`kb-item ${selectedId === entry.id ? 'active' : ''}`} onClick={() => pick(entry.id)}>
            <strong>{entry.title}</strong>
            <small>{entryOrigin(entry) || new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</small>
          </button>)}
        </div>
        <div className="kb-detail">
          {selected ? <>
            <div className="kb-detail-header">
              <div><strong>{selected.title}</strong><small>{entryOrigin(selected) ? `${entryOrigin(selected)} · ` : ''}更新于 {new Date(selected.updatedAt).toLocaleString('zh-CN')}</small></div>
              <div className="model-settings-actions">
                {/* 导入条目下一次重新索引会被整份替换，就地编辑等于白改，因此只允许改手工条目 */}
                {!selected.sourceId && <button className="small-control" onClick={() => { setDraft({ id: selected.id, title: selected.title, content: selected.content }); setConfirmingDelete(false) }}><Pencil size={13} />编辑</button>}
                {confirmingDelete
                  ? <>
                    <button className="small-control" onClick={() => setConfirmingDelete(false)}>不删</button>
                    <button className="small-control danger" disabled={busy} onClick={() => void remove(selected.id)}>确认删除</button>
                  </>
                  : <button className="small-control" onClick={() => setConfirmingDelete(true)}><Trash2 size={13} />删除</button>}
              </div>
            </div>
            <div className="kb-detail-content"><MarkdownRenderer content={selected.content} /></div>
          </>
          : <div className="kb-detail-empty"><FileText size={22} /><p>{entries.length === 0 ? '把常用约定、架构说明贴进来；检索按标题与正文分词匹配，中文无需手动分词。' : '从左侧选择一个条目查看'}</p></div>}
        </div>
      </div>
    }
    {draft && <CenterDialog title={draft.id ? '编辑知识条目' : '新建知识条目'} subtitle="手动维护的内容不会被重新索引覆盖" busy={saving} onClose={() => setDraft(null)}><div className="kb-editor">
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="标题，如：发布流程" aria-label="标题" />
            <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="内容：约定、背景、流程说明……对话相关时会自动注入" aria-label="内容" rows={12} />
            <div className="model-settings-actions">
              <button className="small-control" disabled={saving} onClick={() => setDraft(null)}>取消</button>
              <button className="small-control primary" disabled={!draft.title.trim() || !draft.content.trim() || saving} onClick={() => void save()}>{saving ? '保存中' : '保存'}</button>
            </div>
          </div>
    </CenterDialog>}
  </section>
}
