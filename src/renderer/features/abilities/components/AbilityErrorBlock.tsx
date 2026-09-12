import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

/** 错误块：具体原因 + 解决入口，不只是「失败了」。 */
export function AbilityErrorBlock({ title = '操作失败', message, actions }: { title?: string; message: string; actions?: ReactNode }) {
  return <div className="cap-error-block">
    <CircleAlert size={15} />
    <div>
      <strong>{title}</strong>
      <span>{message}</span>
      {actions && <div className="ability-error-actions">{actions}</div>}
    </div>
  </div>
}
