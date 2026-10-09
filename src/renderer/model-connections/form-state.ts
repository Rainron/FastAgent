export function connectionDraft<T extends { apiKey?: string; name?: string; baseUrl?: string }>(input: T): T {
  const { apiKey, ...rest } = input
  return { ...rest, name: input.name?.trim(), baseUrl: input.baseUrl?.trim(), ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}) } as T
}

export function addModel<T extends { modelId: string; name?: string }>(models: T[], value: string): Array<T | { modelId: string; name: string }> {
  const modelId = value.trim()
  return !modelId || models.some((model) => model.modelId === modelId) ? models : [...models, { modelId, name: modelId }]
}

/** 批量加入：已在连接里的模型保持原样，不用发现结果覆盖用户已经调过的参数。 */
export function mergeModels<T extends { modelId: string }>(models: T[], picked: T[]): T[] {
  const present = new Set(models.map((model) => model.modelId))
  const added: T[] = []
  for (const model of picked) {
    const modelId = model.modelId.trim()
    if (!modelId || present.has(modelId)) continue
    present.add(modelId)
    added.push({ ...model, modelId })
  }
  return added.length ? [...models, ...added] : models
}

export interface ModelConnectionFocus {
  connectionId?: string
  modelId: string
}

/** 优先保留当前有效选择；从模型清单跳转时按连接 id 定位，旧数据再按模型 id 回退。 */
export function selectConnectionId(
  connections: Array<{ id: string; models: Array<{ model_name: string }> }>,
  current: string | null,
  focus?: ModelConnectionFocus | null
): string | null {
  if (current && connections.some((connection) => connection.id === current)) return current
  if (focus?.connectionId && connections.some((connection) => connection.id === focus.connectionId)) return focus.connectionId
  if (focus?.modelId) {
    const matched = connections.find((connection) => connection.models.some((model) => model.model_name === focus.modelId))
    if (matched) return matched.id
  }
  return connections[0]?.id ?? null
}
