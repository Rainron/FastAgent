import type { ReactNode } from 'react'
import { X } from 'lucide-react'

/** 资源树多选时的底部操作栏：Workspace 与 Artifacts 共用外观，操作按钮由使用方给。 */
export function TreeSelectionBar({ count, summary, onClear, children }: { count: number; summary: string; onClear: () => void; children: ReactNode }) {
  return <div className="tree-selection-bar" role="toolbar" aria-label="批量操作">
    <div className="tree-selection-count">
      <strong>已选 {count} 项</strong>
      {summary && <span>{summary}</span>}
    </div>
    <div className="tree-selection-actions">
      {children}
      <button type="button" className="icon" onClick={onClear} aria-label="取消选择" title="取消选择（Esc）"><X size={14} /></button>
    </div>
  </div>
}
