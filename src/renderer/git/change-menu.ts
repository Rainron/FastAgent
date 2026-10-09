/**
 * 未提交改动行的右键菜单项。
 *
 * 只产出描述，动作由组件按 key 分派：菜单项要不要出现、文案怎么写都依赖行的种类与选区，
 * 这部分逻辑值得单测，而 window.fastAgent 的调用不值得也测不了。
 */

export type ChangeMenuKey = 'open' | 'toggleDir' | 'stage' | 'discard' | 'copyPath' | 'copyName' | 'reveal'

export interface ChangeMenuItem {
  key: ChangeMenuKey
  label: string
  danger?: boolean
  /** 该项之前画一条分隔线 */
  separatorBefore?: boolean
}

export interface ChangeMenuContext {
  kind: 'dir' | 'file'
  /** 右键的这一行属于已暂存组还是未暂存组 */
  staged: boolean
  /** 目录行是否已折叠 */
  collapsed: boolean
  /** 实际会被操作的文件数；右键行落在多选里时是整个选区 */
  targetCount: number
  /** 目标是否跨了多个文件，决定文案用单数还是「N 个文件」 */
  multiple: boolean
}

function suffix(context: ChangeMenuContext): string {
  return context.multiple ? ` ${context.targetCount} 个文件` : ''
}

export function buildChangeMenuItems(context: ChangeMenuContext): ChangeMenuItem[] {
  const items: ChangeMenuItem[] = []
  if (context.kind === 'file') items.push({ key: 'open', label: '显示差异' })
  else items.push({ key: 'toggleDir', label: context.collapsed ? '展开目录' : '折叠目录' })
  items.push({
    key: 'stage',
    label: context.staged ? `从暂存区移除${suffix(context)}` : `加入暂存区${suffix(context)}`,
    separatorBefore: true
  })
  items.push({ key: 'discard', label: `丢弃改动${suffix(context)}`, danger: true })
  items.push({ key: 'copyPath', label: '复制相对路径', separatorBefore: true })
  if (context.kind === 'file') items.push({ key: 'copyName', label: '复制文件名' })
  items.push({ key: 'reveal', label: '在文件管理器中显示' })
  return items
}

/**
 * 右键落在已选中的行上时操作整个选区，否则只操作这一行——
 * 和 IDEA / 资源管理器一致，避免右键把用户已有的多选悄悄丢掉。
 */
export function menuTargetPaths(rowPaths: string[], selected: ReadonlySet<string>): string[] {
  const insideSelection = rowPaths.length > 0 && rowPaths.every((path) => selected.has(path))
  if (!insideSelection || selected.size <= rowPaths.length) return rowPaths
  return [...selected]
}
