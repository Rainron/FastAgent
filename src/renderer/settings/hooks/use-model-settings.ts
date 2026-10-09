import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LocalModelSummary, ModelOption } from '../../../shared/types'
import { overrideKey, type ModelParameterOverride } from '../../../shared/model-parameters'

export function useModelSettings(models: ModelOption[], localModels: LocalModelSummary[], onTestDialogue: (id: number) => Promise<{ ok: boolean; error?: string; latencyMs?: number }>, onNotice: (notice: string) => void) {
  const [overrides, setOverrides] = useState<Map<string, ModelParameterOverride>>(new Map())
  const [testingId, setTestingId] = useState<number | null>(null)
  // 覆盖表与云端清单分开取：清单来自 bootstrap（已套过覆盖），这份是给编辑器回填草稿用的原始值。
  async function loadOverrides() {
    const items = await window.fastAgent.models.listOverrides().catch(() => { onNotice('模型参数加载失败'); return [] as Array<{ key: string; override: ModelParameterOverride }> })
    setOverrides(new Map(items.map((item) => [item.key, item.override])))
  }
  useEffect(() => { void loadOverrides() }, [])

  const saveOverride = useCallback(async (model: ModelOption, override: ModelParameterOverride) => {
    const saved = await window.fastAgent.models.setOverride(model.provider, model.model_name, override)
    setOverrides((current) => {
      const next = new Map(current)
      const key = overrideKey(model.provider, model.model_name)
      if (Object.keys(saved).length) next.set(key, saved)
      else next.delete(key)
      return next
    })
    onNotice(Object.keys(saved).length ? `已保存 ${model.model_name} 的本地参数` : `已清除 ${model.model_name} 的本地参数`)
  }, [onNotice])

  interface BulkResult { id: number; label: string; ok: boolean; latencyMs?: number; error?: string }
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null)

  async function handleTestOne(modelId: number, label: string) {
    setTestingId(modelId)
    try {
      const result = await onTestDialogue(modelId)
      onNotice(result.ok
        ? `${label}：对话测试通过（${result.latencyMs ?? '—'} ms）`
        : `${label}：对话测试失败（${result.error ?? '未知错误'}）`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '模型测试失败')
    } finally {
      setTestingId(null)
    }
  }

  // 批量覆盖全部已保存模型：账号云端 + 本地服务连接 + 旧版独立本地。
  const bulkTargets = useMemo(() => [
    ...models.filter((model) => model.source !== 'local' && model.id >= 0).map((model) => ({ id: model.id, label: `${model.provider} / ${model.model_name}` })),
    ...localModels.map((model) => ({ id: model.id, label: `${model.connectionName ?? model.name} / ${model.model_name}` }))
  ], [models, localModels])

  async function runBulkTest() {
    if (bulkRunning || bulkTargets.length === 0) return
    setBulkRunning(true)
    setBulkResults(null)
    const results: (BulkResult | undefined)[] = new Array(bulkTargets.length)
    let cursor = 0
    // 并发太多会同时打到各家服务触发限流，这里控制在 3 路。
    async function worker() {
      while (cursor < bulkTargets.length) {
        const target = bulkTargets[cursor]
        const index = cursor
        cursor += 1
        try {
          const result = await onTestDialogue(target.id)
          results[index] = result.ok
            ? { ...target, ok: true, latencyMs: result.latencyMs }
            : { ...target, ok: false, error: result.error }
        } catch (error) {
          results[index] = { ...target, ok: false, error: error instanceof Error ? error.message : '测试失败' }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, bulkTargets.length) }, () => worker()))
    setBulkRunning(false)
    setBulkResults(results.filter((item): item is BulkResult => Boolean(item)))
  }

  return { overrides, testingId, saveOverride, handleTestOne, bulkRunning, bulkResults, bulkTargets, runBulkTest }
}
