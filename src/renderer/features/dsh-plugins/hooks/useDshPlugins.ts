import { useCallback, useEffect, useState } from 'react'
import type { DshHostState, DshPluginRecord } from '../../../../shared/types'

export interface DshPluginsState {
  plugins: DshPluginRecord[] | null
  host: DshHostState | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

/** 插件列表与宿主状态一起取：卡片上的激活文案离开宿主状态就没法解释。 */
export function useDshPlugins(): DshPluginsState {
  const [plugins, setPlugins] = useState<DshPluginRecord[] | null>(null)
  const [host, setHost] = useState<DshHostState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, state] = await Promise.all([window.fastAgent.dsh.list(), window.fastAgent.dsh.state()])
      setPlugins(list)
      setHost(state)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '插件列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return { plugins, host, error, loading, refresh }
}
