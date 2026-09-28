import type { AuthState } from '../shared/types'

/** 只有账号不可用且本地没有任何模型时，启动才需要停在入口页。 */
export function shouldShowLoginScreen(authState: AuthState, modelCount: number, accountLoginRequested = false): boolean {
  const accountUnavailable = authState !== 'ready'
  return accountUnavailable && (accountLoginRequested || modelCount === 0)
}
