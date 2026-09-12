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

export function ensureAppDirectories(paths: AppPaths) {
  for (const path of [paths.dataDir, paths.sessionsDir, paths.agentDir, paths.skillsDir, paths.mcpDir, paths.pluginsDir, paths.attachmentsDir, paths.backupsDir, paths.exportsDir]) {
    mkdirSync(path, { recursive: true })
  }
}
