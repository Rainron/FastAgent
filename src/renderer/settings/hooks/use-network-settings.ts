import { useEffect, useRef, useState } from 'react'
import type { NetworkProxySettings, NetworkProxyState, NetworkProxyTestResult } from '../../../shared/types'
import { normalizeNetworkProxySettings, validateNetworkProxySettings } from '../../../shared/network-settings'

export function useNetworkSettings(saved: NetworkProxySettings | undefined) {
  const [draft, setDraft] = useState(() => normalizeNetworkProxySettings(saved))
  const [state, setState] = useState<NetworkProxyState | null>(null)
  const [results, setResults] = useState<NetworkProxyTestResult[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const lock = useRef(false)
  const revision = useRef(0)
  useEffect(() => {
    let live = true
    setDraft(normalizeNetworkProxySettings(saved))
    revision.current++
    const request = revision.current
    setResults(null)
    void window.fastAgent.settings.getNetworkProxyState().then((next) => {
      if (!live) return
      setState(next)
      if (revision.current === request) setDraft(next.settings)
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : '代理状态读取失败') })
    return () => { live = false; revision.current++ }
  }, [saved?.mode, saved?.proxyUrl])
  function change(next: NetworkProxySettings) {
    revision.current++
    setDraft(next)
    setResults(null)
    setError('')
  }
  async function run(action: 'save' | 'test') {
    if (lock.current) return
    lock.current = true
    setBusy(action)
    setError('')
    const request = revision.current
    try {
      const input = validateNetworkProxySettings(draft)
      if (action === 'test') {
        const next = await window.fastAgent.settings.testNetworkProxy(input)
        if (request === revision.current) setResults(next)
      } else {
        const next = await window.fastAgent.settings.saveNetworkProxy(input)
        setState(next)
        if (request === revision.current) setDraft(next.settings)
      }
    } catch (cause) {
      if (request === revision.current) setError(cause instanceof Error ? cause.message : '网络设置操作失败')
    } finally { lock.current = false; setBusy(null) }
  }
  return { draft, state, results, error, busy, change, run }
}
