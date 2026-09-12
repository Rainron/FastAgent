import { ChevronLeft, ChevronRight } from 'lucide-react'
import { pageSizeOptions, pageTokens, totalPages } from '../../shared/pagination'

/** 列表底部的统一页码条：上一页 / 页码 / 下一页 / 总条数 / 每页条数。 */
export function Pagination({ page, pageSize, total, disabled = false, onPageChange, onPageSizeChange }: {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const pages = totalPages(total, pageSize)
  const current = Math.min(Math.max(page, 1), pages)
  return <nav className="pagination" aria-label="分页">
    <button className="pagination-step" disabled={disabled || current <= 1} onClick={() => onPageChange(current - 1)}>
      <ChevronLeft size={13} />上一页
    </button>
    <ul className="pagination-pages">
      {pageTokens(current, pages).map((token, index) => token === 'ellipsis'
        // 省略号只是占位，位置就是它的身份，用下标当 key 不会错位
        ? <li key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">…</li>
        : <li key={token}>
            <button
              className={`pagination-page${token === current ? ' active' : ''}`}
              disabled={disabled}
              aria-current={token === current ? 'page' : undefined}
              aria-label={`第 ${token} 页`}
              onClick={() => onPageChange(token)}
            >{token}</button>
          </li>)}
    </ul>
    <button className="pagination-step" disabled={disabled || current >= pages} onClick={() => onPageChange(current + 1)}>
      下一页<ChevronRight size={13} />
    </button>
    <span className="pagination-total">共 {total} 条</span>
    <select
      className="pagination-size"
      value={pageSize}
      disabled={disabled}
      aria-label="每页条数"
      onChange={(event) => onPageSizeChange(Number(event.target.value))}
    >
      {pageSizeOptions(pageSize).map((size) => <option key={size} value={size}>{size} 条/页</option>)}
    </select>
  </nav>
}
