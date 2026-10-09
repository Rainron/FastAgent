import React, { useEffect, useMemo, useState } from 'react'
import { FileCode2, FileText, LoaderCircle, MessageSquare, Search, Wrench } from 'lucide-react'
import type { SearchResult, SearchResultKind } from '../../../shared/types'
import type { WorkspaceProject } from '../../workspace/workspace-types'
import { useDebounced } from '../../use-debounced'
import { countByKind, effectiveKinds, resultLocationLabel, SEARCH_KIND_LABELS, SEARCH_KINDS, skillScopeNotice, toggleKind } from './search-view'
import '../feature-page.css'

const KIND_ICONS: Record<SearchResultKind, React.ReactElement> = {
  conversation: <MessageSquare size={15} />,
  knowledge: <FileText size={15} />,
  skill: <Wrench size={15} />,
  artifact: <FileCode2 size={15} />
}

/**
 * 统一搜索页：一次查会话标题、项目知识、Skill 与成果。
 * 结果点击直接跳到对应内容，不做「复制 id 自己找」这类假入口。
 */
export function SearchPage({ projects, initialProjectId, onOpenResult, onNotice }: {
  projects: WorkspaceProject[]
  initialProjectId: string | null
  onOpenResult: (result: SearchResult) => void
  onNotice: (notice: string) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [projectScope, setProjectScope] = useState(initialProjectId ?? 'all')
  const [kinds, setKinds] = useState<SearchResultKind[]>([])
  const [results, setResults] = useState<SearchResult[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounced = useDebounced(keyword, 220)

  useEffect(() => {
    const trimmed = debounced.trim()
    if (!trimmed) { setResults([]); setTruncated(false); return }
    let cancelled = false
    setLoading(true)
    void window.fastAgent.search.query({
      keyword: trimmed,
      kinds: effectiveKinds(kinds),
      projectId: projectScope === 'all' ? null : projectScope
    })
      .then((response) => {
        if (cancelled) return
        setResults(response.results)
        setTruncated(response.truncated)
      })
      .catch(() => { if (!cancelled) onNotice('搜索失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [debounced, projectScope, kinds, onNotice])

  const counts = useMemo(() => countByKind(results), [results])
  const scopeNotice = kinds.length === 0 || kinds.includes('skill') ? skillScopeNotice(projectScope) : ''
  const visibleProjects = projects.filter((project) => !project.archived)

  return <div className="section-view fp-shell">
    <div className="fp-page">
      <div className="fp-head">
        <div>
          <h1>搜索</h1>
          <p>一次查会话、项目知识、Skill 与成果；结果直接跳到对应内容。</p>
        </div>
      </div>
      <div className="fp-toolbar">
        <div className="fp-search">
          <Search size={14} />
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入关键词" aria-label="统一搜索关键词" autoFocus />
        </div>
        <select value={projectScope} onChange={(event) => setProjectScope(event.target.value)} aria-label="按项目筛选">
          <option value="all">全部范围</option>
          {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <div className="fp-chips" role="group" aria-label="内容类型">
          {SEARCH_KINDS.map((kind) => <button
            key={kind}
            className={kinds.includes(kind) ? 'active' : ''}
            aria-pressed={kinds.includes(kind)}
            onClick={() => setKinds((current) => toggleKind(current, kind))}
          >{SEARCH_KIND_LABELS[kind]}{counts[kind] > 0 ? ` ${counts[kind]}` : ''}</button>)}
        </div>
      </div>
      {scopeNotice && <p className="fp-hint">{scopeNotice}</p>}
      <div className="fp-panel">
        {loading && results.length === 0 && <div className="fp-empty"><LoaderCircle size={16} className="spin" /> 搜索中</div>}
        {!loading && debounced.trim() && results.length === 0 && <div className="fp-empty">没有命中任何内容</div>}
        {!debounced.trim() && <div className="fp-empty">输入关键词开始搜索</div>}
        {results.map((result) => {
          const location = resultLocationLabel(result)
          return <div className="fp-row" key={`${result.kind}:${result.id}`}>
            <button className="fp-result" onClick={() => onOpenResult(result)}>
              <span className="fp-result-icon" aria-hidden="true">{KIND_ICONS[result.kind]}</span>
              <span className="fp-result-copy">
                <strong>{result.title}</strong>
                <small>
                  {result.snippet && <span className="fp-result-snippet">{result.snippet}</span>}
                  {location && <span className="fp-result-location">{location}</span>}
                </small>
              </span>
              <span className="fp-badge muted">{SEARCH_KIND_LABELS[result.kind]}</span>
            </button>
          </div>
        })}
      </div>
      {truncated && <p className="fp-hint">结果较多，只显示了前若干条；缩小关键词范围可以看到更精确的结果。</p>}
    </div>
  </div>
}
