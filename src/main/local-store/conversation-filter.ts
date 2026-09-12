import type { ConversationPageQuery } from '../../shared/types'

/**
 * 会话最后一轮的模式。runtime_config 里没有 mode 时按 defaultRuntimeConfig 算作 chat；
 * 旧库里的 code 模式已并入 agent，比对前就地归一。没有任何一轮时返回 NULL，等价于渲染进程里的 mode === null。
 */
export const LATEST_MODE = `(
  SELECT CASE json_extract(t.runtime_config, '$.mode')
    WHEN 'agent' THEN 'agent'
    WHEN 'code' THEN 'agent'
    ELSE 'chat' END
  FROM conversation_turns t
  WHERE t.namespace = conversations.namespace AND t.conversation_id = conversations.conversation_id
  ORDER BY t.created_at DESC, t.turn_id DESC LIMIT 1
)`

/** 会话最后一轮的状态；没有任何一轮时算 idle，与渲染进程的 status ?? 'idle' 对齐。 */
export const LATEST_STATUS = `COALESCE((
  SELECT t.status FROM conversation_turns t
  WHERE t.namespace = conversations.namespace AND t.conversation_id = conversations.conversation_id
  ORDER BY t.created_at DESC, t.turn_id DESC LIMIT 1
), 'idle')`

/**
 * 拼出会话列表的 WHERE 子句与参数，计数和取页共用同一份，
 * 否则「共 N 条」会和实际筛出来的行对不上。
 * 模式与状态条件只在真的要筛时才拼进去，避免不筛的调用方白付一次相关子查询。
 */
export function conversationFilter(namespace: string, query: ConversationPageQuery, archived: boolean): { where: string; params: unknown[] } {
  const keyword = query.keyword?.trim() || null
  const projectId = query.projectId === undefined ? null : query.projectId
  const conditions = [
    'namespace = ?',
    'archived = ?',
    "(? IS NULL OR title LIKE '%' || ? || '%')",
    '(? IS NULL OR project_id = ?)'
  ]
  const params: unknown[] = [namespace, archived ? 1 : 0, keyword, keyword, projectId, projectId]

  const scope = query.projectScope && query.projectScope !== 'all' ? query.projectScope : null
  if (scope === 'unassigned') {
    conditions.push('project_id IS NULL')
  } else if (scope) {
    conditions.push('project_id = ?')
    params.push(scope)
  }
  if (query.mode) {
    conditions.push(`${LATEST_MODE} = ?`)
    params.push(query.mode)
  }
  if (query.status) {
    conditions.push(`${LATEST_STATUS} = ?`)
    params.push(query.status)
  }
  return { where: conditions.join(' AND '), params }
}
