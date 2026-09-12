import type { StatusPresentation } from '../ability-view'

/** 状态徽章：文案与色调全部来自 ability-view 的单一映射，杜绝同状态异色。 */
export function AbilityStatusBadge({ status, title }: { status: StatusPresentation; title?: string }) {
  return <span className={`ability-badge tone-${status.tone}`} title={title}>{status.label}</span>
}
