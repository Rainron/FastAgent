/** 页码分页的公共算术：主进程算 OFFSET，渲染进程画页码条，两边必须对同一套夹取规则。 */

export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MAX_PAGE_SIZE = 100

export function normalizePageSize(pageSize?: number | null): number {
  if (!pageSize || !Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(Math.floor(pageSize), 1), MAX_PAGE_SIZE)
}

/** 空结果也算 1 页，否则分页器会算出 0 页而无处落脚。 */
export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(total, 0) / normalizePageSize(pageSize)))
}

/** 删除后总数缩水时，停在越界页会拿到空列表，所以统一夹回最后一页。 */
export function resolvePage(page: number | null | undefined, total: number, pageSize: number): number {
  const last = totalPages(total, pageSize)
  if (!page || !Number.isFinite(page)) return 1
  return Math.min(Math.max(Math.floor(page), 1), last)
}

/** 偏好里存着的页长可能不在预置档位里（历史值或手改的库），下拉必须仍能显示当前值。 */
export function pageSizeOptions(current: number): number[] {
  const size = normalizePageSize(current)
  return PAGE_SIZE_OPTIONS.includes(size) ? [...PAGE_SIZE_OPTIONS] : [...PAGE_SIZE_OPTIONS, size].sort((a, b) => a - b)
}

export function pageOffset(page: number, pageSize: number): number {
  return (Math.max(Math.floor(page), 1) - 1) * normalizePageSize(pageSize)
}

export type PageToken = number | 'ellipsis'

/**
 * 页码序列：首末页常驻，当前页两侧各留一个，其余折叠成省略号。
 * 折叠区只剩一页时直接显示该页码——用省略号换一个数字反而更难点。
 */
export function pageTokens(page: number, pages: number, siblings = 1): PageToken[] {
  const last = Math.max(1, Math.floor(pages))
  const current = Math.min(Math.max(Math.floor(page), 1), last)
  // 窗口宽度固定，贴边时向另一侧补齐，避免首末页附近页码数量忽多忽少
  const size = siblings * 2 + 1
  let start = Math.max(1, current - siblings)
  let end = start + size - 1
  if (end > last) {
    end = last
    start = Math.max(1, end - size + 1)
  }
  const tokens: PageToken[] = []
  if (start > 1) {
    tokens.push(1)
    if (start > 2) tokens.push(start === 3 ? 2 : 'ellipsis')
  }
  for (let value = start; value <= end; value += 1) tokens.push(value)
  if (end < last) {
    if (end < last - 1) tokens.push(end === last - 2 ? last - 1 : 'ellipsis')
    tokens.push(last)
  }
  return tokens
}
