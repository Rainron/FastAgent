import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { LocalStore } from './local-store'
import { conversationSessionDir, legacyConversationSessionDir } from './session-paths'

export const SESSION_LAYOUT_VERSION = 2

export interface SessionLayoutMigrationResult {
  /** partial：至少一个会话迁移失败，版本号不落盘，下次登录整轮重试。 */
  status: 'migrated' | 'not-needed' | 'partial'
  conversations: number
  files: number
}

/** 同一数据根下 rename 就够；跨卷（数据目录搬过家）才回落成复制加删除。 */
function moveFile(from: string, to: string) {
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(from, to)
    rmSync(from, { force: true })
  }
}

/** 旧布局一律是 sessions 的直接子目录；新布局是三层，据此挡住「已经迁过的别再动」。 */
function isLegacyDirectory(sessionsDir: string, directory: string) {
  return dirname(directory) === resolve(sessionsDir)
}

/**
 * 把旧的一层哈希 session 目录迁到「用户/日期/会话」布局，并同步改写库内路径。
 *
 * 历史上哈希算法换过三代（namespace / namespace+会话+模型 / namespace+会话），单靠重算旧目录名
 * 只能覆盖最后一代，所以旧目录以「库里记录的 session_file 的父目录」为准，重算值只作补充。
 * 早期按 namespace 分桶的目录会被多个会话共用，这种目录只搬本会话引用到的文件，其余留给别的会话。
 */
export function migrateConversationSessions(input: { sessionsDir: string; store: LocalStore; namespace: string; userSegment: string }): SessionLayoutMigrationResult {
  const { sessionsDir, store, namespace, userSegment } = input
  if (store.getSessionLayoutVersion(namespace) >= SESSION_LAYOUT_VERSION) return { status: 'not-needed', conversations: 0, files: 0 }

  const bindings = store.listConversationSessionBindings(namespace)
  const runtimeFiles = store.listModelRuntimeSessionFiles(namespace)

  // 会话 -> 它引用过的文件；目录 -> 引用它的会话集合。后者用来判断目录是不是被共用。
  const filesByConversation = new Map<string, Set<string>>()
  const conversationsByDirectory = new Map<string, Set<string>>()
  const record = (conversationId: string, sessionFile: string | null) => {
    if (!sessionFile) return
    const directory = dirname(sessionFile)
    if (!isLegacyDirectory(sessionsDir, directory)) return
    if (!filesByConversation.has(conversationId)) filesByConversation.set(conversationId, new Set())
    filesByConversation.get(conversationId)!.add(sessionFile)
    if (!conversationsByDirectory.has(directory)) conversationsByDirectory.set(directory, new Set())
    conversationsByDirectory.get(directory)!.add(conversationId)
  }
  for (const binding of bindings) record(binding.conversationId, binding.sessionFile)
  for (const runtime of runtimeFiles) record(runtime.conversationId, runtime.sessionFile)

  let conversations = 0
  let files = 0
  let failed = false
  for (const binding of bindings) {
    const referenced = filesByConversation.get(binding.conversationId) ?? new Set<string>()
    const legacyDir = legacyConversationSessionDir(sessionsDir, namespace, binding.conversationId)
    const directories = new Set([...referenced].map((file) => dirname(file)))
    if (existsSync(legacyDir)) directories.add(legacyDir)
    if (!directories.size) continue

    const targetDir = conversationSessionDir(sessionsDir, { userSegment, createdAt: binding.createdAt, conversationId: binding.conversationId })
    // 单个会话失败不该挡住其余会话；这一轮不写版本号，下次登录再试。
    try {
      mkdirSync(targetDir, { recursive: true })
      for (const directory of directories) {
        if (!existsSync(directory)) continue
        // 目录只被这一个会话引用时整目录搬走，能把压缩后重开、pi 分支这些没记进库的文件一起带上。
        const exclusive = (conversationsByDirectory.get(directory)?.size ?? 0) <= 1
        const names = exclusive
          ? readdirSync(directory).filter((name) => statSync(join(directory, name)).isFile())
          : [...referenced].filter((file) => dirname(file) === directory).map((file) => basename(file))
        for (const name of names) {
          const target = join(targetDir, name)
          // 目标同名文件存在说明已经迁过或撞名，宁可留着旧文件也不覆盖。
          if (existsSync(target) || !existsSync(join(directory, name))) continue
          moveFile(join(directory, name), target)
          files += 1
        }
        store.remapModelRuntimeSessionFiles(namespace, binding.conversationId, directory, targetDir)
        if (!readdirSync(directory).length) rmdirSync(directory)
      }
      if (binding.sessionFile && directories.has(dirname(binding.sessionFile))) {
        store.setConversationSessionFile(namespace, binding.conversationId, join(targetDir, basename(binding.sessionFile)))
      }
      conversations += 1
    } catch (error) {
      failed = true
      console.error('[session-layout]', binding.conversationId, error)
    }
  }
  if (failed) return { status: 'partial', conversations, files }
  store.setSessionLayoutVersion(namespace, SESSION_LAYOUT_VERSION)
  return { status: 'migrated', conversations, files }
}
