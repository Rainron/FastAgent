/**
 * 侧栏搜索结果的键盘选取。
 *
 * 上下方向键在结果里移动，回车进入当前项。逻辑抽出来是因为两处（项目、对话）行为必须一致，
 * 而且越界回绕这种事写在组件里很容易两边写岔。
 */

export type SidebarSearchKey = 'ArrowDown' | 'ArrowUp' | 'Enter' | 'Escape' | string

/** 没有结果时返回 -1；有结果时在 [0, count) 内回绕，方便一路按下去回到第一条。 */
export function nextSearchIndex(current: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : count - 1
  return (current + direction + count) % count
}

/** 结果集变了以后旧下标可能越界或指向别的条目，统一夹回第一条。 */
export function clampSearchIndex(current: number, count: number): number {
  if (count <= 0) return -1
  return current >= 0 && current < count ? current : 0
}
