import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { ensureAppDirectories, readDataRootLocator, resolveAppPaths, writeDataRootLocator } from './app-paths'

const roots: string[] = []

function tempRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('app paths', () => {
  it('将持久数据放在 ~/.fa，缓存与日志保留在平台目录', () => {
    const home = join(tempRoot('fastagent-home-'), 'home')
    const userData = join(home, 'AppData', 'Roaming', 'FastAgent')
    const paths = resolveAppPaths({ home, userData, cache: join(home, 'cache'), logs: join(home, 'logs'), temp: join(home, 'temp') })

    expect(paths.dataRoot).toBe(join(home, '.fa'))
    expect(paths.databasePath).toBe(join(home, '.fa', 'data', 'fastagent.db'))
    expect(paths.sessionsDir).toBe(join(home, '.fa', 'sessions'))
    expect(paths.skillsDir).toBe(join(home, '.fa', 'skills'))
    expect(paths.cacheDir).toBe(join(home, 'cache'))
    expect(paths.logsDir).toBe(join(home, 'logs'))
    expect(paths.locatorPath).toBe(join(userData, 'data-location.json'))
  })

  it('只接受 locator 中的绝对目录，损坏内容回退默认目录', () => {
    const root = tempRoot('fastagent-locator-')
    const home = join(root, 'home')
    const userData = join(root, 'user-data')
    const custom = join(root, 'custom-data')

    writeDataRootLocator(userData, custom)
    expect(readDataRootLocator(userData, home)).toBe(custom)
    expect(isAbsolute(readDataRootLocator(userData, home))).toBe(true)

    writeFileSync(join(userData, 'data-location.json'), '{"dataRoot":"relative/path"}', 'utf8')
    expect(readDataRootLocator(userData, home)).toBe(join(home, '.fa'))

    writeFileSync(join(userData, 'data-location.json'), 'broken', 'utf8')
    expect(readDataRootLocator(userData, home)).toBe(join(home, '.fa'))
  })

  it('以原子替换方式写 locator 并创建受管目录', () => {
    const root = tempRoot('fastagent-directories-')
    const paths = resolveAppPaths({ home: join(root, 'home'), userData: join(root, 'user-data'), cache: join(root, 'cache'), logs: join(root, 'logs'), temp: join(root, 'temp') })

    ensureAppDirectories(paths)
    writeDataRootLocator(paths.platformUserDataDir, paths.dataRoot)

    expect(JSON.parse(readFileSync(paths.locatorPath, 'utf8'))).toMatchObject({ schemaVersion: 1, dataRoot: paths.dataRoot })
    for (const path of [paths.dataDir, paths.sessionsDir, paths.skillsDir, paths.attachmentsDir, paths.backupsDir, paths.exportsDir]) {
      expect(() => writeFileSync(join(path, '.probe'), '', 'utf8')).not.toThrow()
    }
  })

  it('locator 已指向同一目录时不重复写入', () => {
    const root = tempRoot('fastagent-locator-unchanged-')
    const userData = join(root, 'user-data')
    const dataRoot = join(root, 'custom-data')
    const locatorPath = join(userData, 'data-location.json')
    const original = `{ "schemaVersion": 1, "dataRoot": ${JSON.stringify(dataRoot)} }\n\n`

    writeDataRootLocator(userData, dataRoot)
    writeFileSync(locatorPath, original, 'utf8')
    writeDataRootLocator(userData, dataRoot)

    expect(readFileSync(locatorPath, 'utf8')).toBe(original)
  })
})
