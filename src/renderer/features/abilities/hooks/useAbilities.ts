import { useCallback, useEffect, useState } from 'react'
import type { Ability } from '../../../../shared/types'
import { abilitiesService } from '../services/abilities-service'

export interface AbilitiesState {
  abilities: Ability[] | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

/** 取全量能力：分页要按 Tab 的能力类型分别算，混在一起分页会把 MCP 挤到 Skill 后面的页里。 */
export function useAbilities(): AbilitiesState {
  const [abilities, setAbilities] = useState<Ability[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setAbilities(await abilitiesService.list())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '能力列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return { abilities, error, loading, refresh }
}
