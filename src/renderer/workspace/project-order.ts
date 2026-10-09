/**
 * 侧栏工作区项目的手动排序。
 *
 * 存本地而不落库：顺序只是这台机器上的侧栏偏好，和 sidebar-width 同一口径。
 * 只存 id 数组，项目增删不需要同步清理——不在顺序里的按名称排在后面，已删除的 id 读时自然被忽略。
 */
export const PROJECT_ORDER_KEY = 'fastagent.sidebar-project-order.v1'

interface OrderableProject {
  id: string
  name: string
}

export function readProjectOrder(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = storage.getItem(PROJECT_ORDER_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    // 存储不可用或内容损坏时退回名称排序，不能挡住侧栏渲染
    return []
  }
}

export function writeProjectOrder(storage: Pick<Storage, 'setItem'>, order: string[]): void {
  try {
    storage.setItem(PROJECT_ORDER_KEY, JSON.stringify(order))
  } catch {
    // 存不下就只在本次会话里生效
  }
}

/** 手动排过的项目按保存的顺序在前，其余（新加的、从没拖过的）按名称排在后面。 */
export function applyProjectOrder<T extends OrderableProject>(projects: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]))
  return projects.slice().sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

/**
 * 实时换位排序的落点：被拖项目行的中心离哪一项的原始中心最近，就占到那一项的位置。
 * 比「越过中线才算」更跟手——拖过半个身位就让位，和系统列表的手感一致。
 * 返回值与 moveProjectId 同一口径（插入到第几项之前，以挪动前的下标计）。
 */
export function sortDropIndex(centers: number[], from: number, draggedCenter: number): number {
  if (from < 0 || !centers.length) return from
  let closest = from
  centers.forEach((center, index) => {
    if (Math.abs(center - draggedCenter) < Math.abs(centers[closest] - draggedCenter)) closest = index
  })
  return closest > from ? closest + 1 : closest
}

/** 拖到 dropIndex 时，第 index 项要让位的方向：被拖项目往下走，途经的项上移；往上走则下移。 */
export function shiftDirection(index: number, from: number, dropIndex: number): -1 | 0 | 1 {
  if (from < 0 || index === from) return 0
  if (dropIndex > from + 1 && index > from && index < dropIndex) return -1
  if (dropIndex < from && index >= dropIndex && index < from) return 1
  return 0
}

/**
 * 把 id 从当前位置挪到 dropIndex（以挪动前的下标计的插入点）。
 * 落回原位时返回 null，调用方据此跳过写存储。
 */
export function moveProjectId(ids: string[], id: string, dropIndex: number): string[] | null {
  const from = ids.indexOf(id)
  if (from < 0) return null
  const target = Math.min(Math.max(dropIndex, 0), ids.length)
  // 插入点在自己或紧挨着的下一位，挪完顺序不变
  if (target === from || target === from + 1) return null
  const next = ids.filter((item) => item !== id)
  next.splice(target > from ? target - 1 : target, 0, id)
  return next
}
