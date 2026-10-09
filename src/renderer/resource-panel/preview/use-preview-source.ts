import { useEffect, useRef, useState } from 'react'
import { parseIpcError } from '../../ipc-error'
import { affectsPreview } from './preview-target'

/** 改动后合并刷新：一次写入往往连着几个文件，逐个刷会闪好几下。 */
const RELOAD_DEBOUNCE_MS = 300

export interface PreviewSourceInput {
  /** 已知的可载入地址；工作区里直接点开的 .html 没有，按 path 向主进程要。 */
  url: string | null
  path: string | null
}

/**
 * 预览源的生命周期：解析地址 → 探测可达 → 载入；页面相关文件被 Agent 改动、或模型再次调用
 * preview_show 时自动刷新。reloadKey 用于重建 iframe——跨源 iframe 不能从外面调 reload。
 */
export function usePreviewSource(source: PreviewSourceInput) {
  const [url, setUrl] = useState<string | null>(source.url)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const errorRef = useRef('')
  errorRef.current = error

  useEffect(() => {
    let alive = true
    setError('')
    setLoading(true)
    const resolving = source.url ? Promise.resolve(source.url) : source.path ? window.fastAgent.preview.fileUrl(source.path) : Promise.reject(new Error('没有可预览的地址'))
    resolving
      .then(async (resolved) => {
        const probe = await window.fastAgent.preview.probe(resolved)
        if (!alive) return
        setUrl(resolved)
        if (!probe.ok) setError(probe.error ?? '无法加载预览')
      })
      .catch((cause: unknown) => { if (alive) setError(parseIpcError(cause, '无法打开预览').message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [source.url, source.path, attempt])

  // 出错态（文件还没写出来、服务还没起）下的改动要重新探测，正常态只需重建 iframe。
  useEffect(() => {
    if (!source.path) return
    let timer: number | undefined
    const off = window.fastAgent.chat.onEvent((event) => {
      if (event.type !== 'file_changed' || !affectsPreview(source.path, event.path)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (errorRef.current) setAttempt((value) => value + 1)
        else setReloadKey((value) => value + 1)
      }, RELOAD_DEBOUNCE_MS)
    })
    return () => { off(); window.clearTimeout(timer) }
  }, [source.path])

  // 模型改完页面会再调一次 preview_show 复查：同一地址的就绪通知也刷新一次。
  useEffect(() => {
    if (!url) return
    return window.fastAgent.preview.onReady((event) => {
      if (event.target.url === url) setReloadKey((value) => value + 1)
    })
  }, [url])

  return {
    url,
    error,
    loading,
    reloadKey,
    reload: () => setReloadKey((value) => value + 1),
    retry: () => setAttempt((value) => value + 1)
  }
}
