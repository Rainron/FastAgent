/** 压缩失败的分类错误：渲染进程按 code 区分「超时 / 模型报错 / 用户取消」，不看 message。 */
export class CompactionError extends Error {
  constructor(public readonly code: 'COMPACTION_TIMEOUT' | 'COMPACTION_MODEL_ERROR' | 'COMPACTION_CANCELLED', message: string) {
    super(message)
    this.name = code
  }
}
