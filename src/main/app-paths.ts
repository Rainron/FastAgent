import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'

export interface PlatformAppPaths {
  home: string
  userData: string
  cache: string
  /** 日志目录；由 logging/log-paths 解析（优先安装目录，不可写时回落到平台日志目录）。 */
  logs: string
  temp: string
}

export interface AppPaths {
  dataRoot: string
  dataDir: string
  databasePath: string
  sessionsDir: string
  agentDir: string
  skillsDir: string
  mcpDir: string
  pluginsDir: string
  attachmentsDir: string
  /** 未绑定项目的会话（快速对话的 agent 模式是主要来源）的工作目录，避免落到应用安装目录。 */
  quickWorkspaceDir: string
  backupsDir: string
  exportsDir: string
  cacheDir: string
  logsDir: string
  tempDir: string
  platformUserDataDir: string
  locatorPath: string
  legacyDatabasePath: string
  legacySessionsDir: string
  legacyAgentDir: string
}

interface DataRootLocator {
  schemaVersion: 1
  dataRoot: string
}

export function defaultDataRoot(home: string) {
  return join(home, '.fa')
}

export function readDataRootLocator(userData: string, home: string) {
  const fallback = defaultDataRoot(home)
  const locatorPath = join(userData, 'data-location.json')
  if (!existsSync(locatorPath)) return fallback
  try {
    const parsed = JSON.parse(readFileSync(locatorPath, 'utf8')) as Partial<DataRootLocator>
    return parsed.schemaVersion === 1 && typeof parsed.dataRoot === 'string' && isAbsolute(parsed.dataRoot)
      ? resolve(parsed.dataRoot)
      : fallback
  } catch {
    return fallback
  }
}

export function writeDataRootLocator(userData: string, dataRoot: string) {
  if (!isAbsolute(dataRoot)) throw new Error('数据目录必须是绝对路径')
  mkdirSync(userData, { recursive: true })
  const locatorPath = join(userData, 'data-location.json')
  const normalizedRoot = resolve(dataRoot)
  if (existsSync(locatorPath)) {
    try {
      const current = JSON.parse(readFileSync(locatorPath, 'utf8')) as Partial<DataRootLocator>
      if (current.schemaVersion === 1 && typeof current.dataRoot === 'string' && isAbsolute(current.dataRoot) && resolve(current.dataRoot) === normalizedRoot) return
    } catch {
      // 损坏的 locator 仍需要用有效内容覆盖。
    }
  }
  const temporaryPath = `${locatorPath}.${randomUUID()}.tmp`
  const payload: DataRootLocator = { schemaVersion: 1, dataRoot: normalizedRoot }
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    renameSync(temporaryPath, locatorPath)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function resolveAppPaths(platform: PlatformAppPaths, dataRoot = readDataRootLocator(platform.userData, platform.home)): AppPaths {
  const normalizedRoot = resolve(dataRoot)
  return {
    dataRoot: normalizedRoot,
    dataDir: join(normalizedRoot, 'data'),
    databasePath: join(normalizedRoot, 'data', 'fastagent.db'),
    sessionsDir: join(normalizedRoot, 'sessions'),
    agentDir: join(normalizedRoot, 'agent'),
    skillsDir: join(normalizedRoot, 'skills'),
    mcpDir: join(normalizedRoot, 'mcp'),
    pluginsDir: join(normalizedRoot, 'plugins'),
    attachmentsDir: join(normalizedRoot, 'attachments'),
    quickWorkspaceDir: join(normalizedRoot, 'quick-workspace'),
    backupsDir: join(normalizedRoot, 'backups'),
    exportsDir: join(normalizedRoot, 'exports'),
    cacheDir: platform.cache,
    logsDir: platform.logs,
    tempDir: platform.temp,
    platformUserDataDir: platform.userData,
    locatorPath: join(platform.userData, 'data-location.json'),
    legacyDatabasePath: join(platform.userData, 'fastagent.db'),
    legacySessionsDir: join(platform.userData, 'sessions'),
    legacyAgentDir: join(platform.userData, 'agent')
  }
}

/**
 * 历史版本调用过 pi 的 setAutoCompactionEnabled(false)，该 API 会把 compaction.enabled=false
 * 落盘到 agentDir/settings.json；代码删掉后文件还在，用户看到的仍是「自动压缩已关闭」。
 * 只在确实是 false 时返回改写后的文本，其余情况返回 null 表示不写。
 */
export function withCompactionEnabled(raw: string | null): string | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const settings = parsed as { compaction?: { enabled?: unknown } }
  if (settings.compaction?.enabled !== false) return null
  return `${JSON.stringify({ ...settings, compaction: { ...settings.compaction, enabled: true } }, null, 2)}\n`
}

/** withCompactionEnabled 的读写薄壳；失败只告警，不阻断启动。 */
export function healAgentSettings(paths: AppPaths) {
  const settingsPath = join(paths.agentDir, 'settings.json')
  try {
    if (!existsSync(settingsPath)) return
    const healed = withCompactionEnabled(readFileSync(settingsPath, 'utf8'))
    if (!healed) return
    writeFileSync(settingsPath, healed, 'utf8')
    console.info('[compaction] 已修复 agent settings.json 中被关闭的自动压缩')
  } catch (error) {
    console.warn('[compaction] 修复 agent settings.json 失败:', error)
  }
}

export function ensureAppDirectories(paths: AppPaths) {
  for (const path of [paths.dataDir, paths.sessionsDir, paths.agentDir, paths.skillsDir, paths.mcpDir, paths.pluginsDir, paths.attachmentsDir, paths.quickWorkspaceDir, paths.backupsDir, paths.exportsDir]) {
    mkdirSync(path, { recursive: true })
  }
}
