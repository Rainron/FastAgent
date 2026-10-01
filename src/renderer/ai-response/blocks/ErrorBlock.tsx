import { memo } from 'react'
import { Ban, CircleAlert } from 'lucide-react'
import type { ErrorBlock as ErrorBlockData } from '../blocks'

function ErrorBlockView({ block }: { block: ErrorBlockData }) {
  const danger = block.status === 'error'
  return (
    <div className={`error-block ${danger ? 'danger' : ''}`} role={danger ? 'alert' : undefined}>
      {/* 非 danger 是「已取消」「操作未执行」这类没做成但不算出错的结局，用 ⊘ 与状态色体系对齐 */}
      {danger ? <CircleAlert size={13} /> : <Ban size={13} />}
      <span className="error-block-title">{block.title}</span>
      {block.detail && <span className="error-block-detail">{block.detail}</span>}
    </div>
  )
}

export const ErrorBlockRenderer = memo(ErrorBlockView)
