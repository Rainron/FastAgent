import type { LocalModelSummary } from '../shared/types'

export function listLocalModelCatalog(store: {
  listLocalModels(): LocalModelSummary[]
  modelConnections(): { listModels(): LocalModelSummary[] }
}): LocalModelSummary[] {
  // 连接名称与认证状态来自连接表，原始模型行只用于保留尚未迁移的旧模型。
  return [...store.modelConnections().listModels(), ...store.listLocalModels().filter((model) => !model.connectionId)]
}
