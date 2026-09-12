import type { Ability, AbilityType, PageQuery, PageResult } from '../../../../shared/types'

/** Renderer 不直接碰文件系统与密钥，能力相关操作一律经由这层走 IPC。 */
export const abilitiesService = {
  list: (): Promise<Ability[]> => window.fastAgent.abilities.list(),
  listPage: (query?: PageQuery): Promise<PageResult<Ability>> => window.fastAgent.abilities.listPage(query),
  get: (type: AbilityType, id: string) => window.fastAgent.abilities.get(type, id),
  setEnabled: (type: AbilityType, id: string, enabled: boolean) => window.fastAgent.abilities.setEnabled(type, id, enabled),
  openLocation: (type: AbilityType, id: string) => window.fastAgent.abilities.openLocation(type, id)
}
