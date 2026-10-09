import { useEffect, useRef, useState } from 'react'
import type { RecallPreview } from '../../../shared/types'

/** 召回测试：问句 + 项目两个输入，点「测试」才查；换项目后旧结果作废，免得对着别的项目的结果误判。 */
export function useRecallPreview(currentProjectId: string | null) {
  const [text, setText] = useState('')
  const [projectId, setProjectId] = useState<string | null>(currentProjectId)
  const [result, setResult] = useState<{ preview: RecallPreview; projectId: string | null } | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => { setResult(null); setError(null) }, [projectId])
  useEffect(() => () => { requestId.current += 1 }, [])

  async function run() {
    const query = text.trim()
    if (!query || running) return
    const request = ++requestId.current
    setRunning(true)
    setError(null)
    try {
      const preview = await window.fastAgent.memories.previewRecall(query, projectId)
      if (request === requestId.current) setResult({ preview, projectId })
    } catch { if (request === requestId.current) setError('召回测试失败，请重试') }
    finally { if (request === requestId.current) setRunning(false) }
  }

  return { text, setText, projectId, setProjectId, result, running, error, run }
}
