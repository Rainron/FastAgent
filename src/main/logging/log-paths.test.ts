import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveLogDir } from './log-paths'

const base = {
  execPath: join('C:', 'Program Files', 'FastAgent', 'FastAgent.exe'),
  projectRoot: join('K:', 'cc-project', 'fastagent-desktop'),
  userDataLogs: join('C:', 'Users', 'lake', 'AppData', 'Roaming', 'fastagent-desktop', 'logs')
}

describe('resolveLogDir', () => {
  it('打包态优先用安装目录下的 logs', () => {
    const result = resolveLogDir({ ...base, packaged: true, probe: () => true })
    expect(result).toEqual({ dir: join('C:', 'Program Files', 'FastAgent', 'logs'), fallback: false, reason: null })
  })

  it('安装目录不可写时回落到 userData 并说明原因', () => {
    const installLogs = join('C:', 'Program Files', 'FastAgent', 'logs')
    const result = resolveLogDir({ ...base, packaged: true, probe: (dir) => dir !== installLogs })
    expect(result.dir).toBe(base.userDataLogs)
    expect(result.fallback).toBe(true)
    expect(result.reason).toContain(installLogs)
  })

  it('开发态用项目根目录，不碰 node_modules 里的 electron.exe', () => {
    const result = resolveLogDir({
      ...base,
      execPath: join('K:', 'cc-project', 'fastagent-desktop', 'node_modules', 'electron', 'dist', 'electron.exe'),
      packaged: false,
      probe: () => true
    })
    expect(result.dir).toBe(join('K:', 'cc-project', 'fastagent-desktop', 'logs'))
    expect(result.fallback).toBe(false)
  })

  it('两处都不可写时仍返回回落目录，由写入侧自行容错', () => {
    const result = resolveLogDir({ ...base, packaged: true, probe: () => false })
    expect(result.dir).toBe(base.userDataLogs)
    expect(result.fallback).toBe(true)
    expect(result.reason).toContain('均不可写')
  })
})
