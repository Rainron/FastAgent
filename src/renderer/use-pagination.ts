import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PAGE_SIZE, normalizePageSize } from '../shared/pagination'

export const PAGINATION_PAGE_SIZE_CHANGED = 'fastagent:pagination-page-size-changed'

export function notifyPaginationPageSizeChanged(pageSize: number) {
  window.dispatchEvent(new CustomEvent(PAGINATION_PAGE_SIZE_CHANGED, { detail: normalizePageSize(pageSize) }))
}

export interface PaginationState {
  page: number
  pageSize: number
  setPage: (page: number) => void
  /** 改页长会写回全局偏好，所有列表共用同一个值 */
  setPageSize: (pageSize: number) => void
}

/** 页码与页长的公共状态：页长取自 ClientPreferences.paginationPageSize，改动即刻落库。 */
export function usePagination(): PaginationState {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE)

  useEffect(() => {
    void window.fastAgent.preferences.get()
      .then((preferences) => setPageSizeState(normalizePageSize(preferences.paginationPageSize)))
      .catch(() => undefined)
    const syncPageSize = (event: Event) => {
      const next = (event as CustomEvent<number>).detail
      setPageSizeState(normalizePageSize(next))
      setPage(1)
    }
    window.addEventListener(PAGINATION_PAGE_SIZE_CHANGED, syncPageSize)
    return () => window.removeEventListener(PAGINATION_PAGE_SIZE_CHANGED, syncPageSize)
  }, [])

  const setPageSize = useCallback((next: number) => {
    const size = normalizePageSize(next)
    setPageSizeState(size)
    // 页长变了原来的页码没有对应关系，直接回到第一页
    setPage(1)
    void window.fastAgent.preferences.update({ paginationPageSize: size }).catch(() => undefined)
    notifyPaginationPageSizeChanged(size)
  }, [])

  return { page, pageSize, setPage, setPageSize }
}
