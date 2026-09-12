import type { ReactNode } from 'react'

/** 空状态：说明为什么空 + 下一步能做什么，不留裸文案。 */
export function AbilityEmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="ability-empty">
    <strong>{title}</strong>
    <span>{description}</span>
    {action && <div className="ability-empty-actions">{action}</div>}
  </div>
}

export function AbilityLoadingState({ label = '加载中…' }: { label?: string }) {
  return <div className="ability-loading" role="status">{label}</div>
}
