import { useEffect } from 'react'
import { LoaderCircle, SearchCheck } from 'lucide-react'
import type { MemoryType } from '../../shared/types'
import { useRecallPreview } from './hooks/use-recall-preview'
import { entryOrigin, recallEmptyReason } from './kb-source-view'

const TYPE_LABEL: Record<MemoryType, string> = { preference: '偏好', fact: '事实', decision: '决定', experience: '经验' }

/**
 * 召回测试：输入一句话，看按当前设置这一轮会注入哪些记忆与知识条目。
 * 记忆、知识库召回都靠关键词匹配，命不中时用户很难自己推断原因，这里把结果和原因一起摆出来。
 */
export function RecallPreviewPanel({ projects, currentProjectId }: { projects: ReadonlyArray<{ id: string; name: string }>; currentProjectId: string | null }) {
  const { text, setText, projectId, setProjectId, result, running, error, run } = useRecallPreview(currentProjectId)
  // 项目列表是异步加载的；当前项目已归档或被移除时退回「未归属」，不让下拉显示一个不存在的值
  useEffect(() => {
    if (projects.length && projectId && !projects.some((project) => project.id === projectId)) setProjectId(null)
  }, [projects, projectId, setProjectId])
  return <section className="settings-panel" aria-labelledby="recall-preview">
    <div className="settings-section-heading"><div><h2 id="recall-preview">召回测试</h2><p>模拟一轮提问，查看按当前设置会注入哪些记忆与知识条目；不影响排序，也不会记入召回记录。</p></div></div>
    <form className="recall-preview-form" onSubmit={(event) => { event.preventDefault(); void run() }}>
      <select value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)} aria-label="模拟的会话项目">
        <option value="">未归属项目的对话</option>
        {projects.map((project) => <option key={project.id} value={project.id}>项目 · {project.name}</option>)}
      </select>
      <input value={text} onChange={(event) => setText(event.target.value)} placeholder="输入一句提问，如：这个项目怎么发布" aria-label="测试提问" />
      <button className="small-control primary" type="submit" disabled={!text.trim() || running}>{running ? <LoaderCircle size={13} className="spin" /> : <SearchCheck size={13} />}测试</button>
    </form>
    {error && <div className="section-list-empty" role="alert">{error}</div>}
    {result && <div className="recall-preview-result" aria-live="polite">
      <div className="recall-preview-group">
        <strong>记忆 · {result.preview.memories.length}</strong>
        {result.preview.memories.length === 0
          ? <p className="recall-preview-empty">{recallEmptyReason('memory', result.preview, result.projectId)}</p>
          : <ul>{result.preview.memories.map((memory) => <li key={memory.id}><span className="settings-badge muted">{TYPE_LABEL[memory.type]}</span><span>{memory.content}</span></li>)}</ul>}
      </div>
      <div className="recall-preview-group">
        <strong>知识条目 · {result.preview.knowledge.length}</strong>
        {result.preview.knowledge.length === 0
          ? <p className="recall-preview-empty">{recallEmptyReason('knowledge', result.preview, result.projectId)}</p>
          : <ul>{result.preview.knowledge.map((entry) => <li key={entry.id}><span>{entry.title}</span>{entryOrigin(entry) && <small>{entryOrigin(entry)}</small>}</li>)}</ul>}
      </div>
    </div>}
  </section>
}
