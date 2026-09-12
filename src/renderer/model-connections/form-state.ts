export function connectionDraft<T extends { apiKey?: string; name?: string; baseUrl?: string }>(input: T): T {
  const { apiKey, ...rest } = input
  return { ...rest, name: input.name?.trim(), baseUrl: input.baseUrl?.trim(), ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}) } as T
}

export function addModel<T extends { modelId: string; name?: string }>(models: T[], value: string): Array<T | { modelId: string; name: string }> {
  const modelId = value.trim()
  return !modelId || models.some((model) => model.modelId === modelId) ? models : [...models, { modelId, name: modelId }]
}

export function visibleLegacyModels<T extends { id: number }>(models: T[], connections: Array<{ models: Array<{ id: number }> }>): T[] {
  const managed = new Set(connections.flatMap((connection) => connection.models.map((model) => model.id)))
  return models.filter((model) => !managed.has(model.id))
}
