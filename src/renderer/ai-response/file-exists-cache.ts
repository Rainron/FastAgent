// 回答里的文件引用要先确认存在才渲染成可点芯片。
// 同一条路径会在流式输出的每一帧、以及多个消息块里反复出现，查询必须去重并缓存，
// 否则每秒几十次 IPC 全打在主进程的同步 fs 上。

type Listener = (exists: boolean) => void

/**
 * 「不存在」只缓存很短一段时间：Agent 会在回答里先提到文件、再把它建出来，
 * 永久缓存 false 会让同一条引用在文件建好之后依然是一段普通代码。「存在」可以一直缓存。
 */
const MISSING_TTL_MS = 5000
const results = new Map<string, { exists: boolean; at: number }>()
const pending = new Map<string, Promise<boolean>>()

/** 切换工作区后旧结论全部失效：同一个相对路径在新项目里可能不存在。 */
export function resetFileExistsCache(): void {
  results.clear()
  pending.clear()
}

/** 已知结论；未查过返回 undefined，调用方据此决定是否发起查询。 */
export function cachedFileExists(path: string): boolean | undefined {
  const entry = results.get(path)
  if (!entry) return undefined
  if (!entry.exists && Date.now() - entry.at > MISSING_TTL_MS) { results.delete(path); return undefined }
  return entry.exists
}

export function queryFileExists(path: string, notify: Listener): () => void {
  const known = cachedFileExists(path)
  if (known !== undefined) { notify(known); return () => {} }
  let active = true
  let request = pending.get(path)
  if (!request) {
    request = window.fastAgent.workspace.exists(path)
      .catch(() => false)
      .then((exists) => { results.set(path, { exists, at: Date.now() }); pending.delete(path); return exists })
    pending.set(path, request)
  }
  void request.then((exists) => { if (active) notify(exists) })
  return () => { active = false }
}
