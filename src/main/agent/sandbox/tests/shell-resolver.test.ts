import { afterEach, describe, expect, it } from 'vitest'
import { resetBashPathCache, resolveBashPath, resolveShellToolName } from '../shell-resolver'

// 全部用假文件系统与假探测，测试不依赖测试机的真实安装情况。
const allExist = () => true

const win32Env = {
  PATH: 'C:\\Windows\\System32;C:\\Tools',
  ProgramFiles: 'C:\\Program Files'
}

const ok = () => true
const fail = () => false

afterEach(() => resetBashPathCache())

describe('resolveBashPath', () => {
  it('非 Windows 平台不做探测，交回 pi 自行解析', () => {
    expect(resolveBashPath({ platform: 'linux', env: {}, exists: allExist, probe: fail })).toBeNull()
  })

  it('显式路径优先于自动探测', () => {
    const probed: string[] = []
    const result = resolveBashPath({
      platform: 'win32',
      env: win32Env,
      explicitPath: 'D:\\msys64\\usr\\bin\\bash.exe',
      exists: allExist,
      probe: (path) => { probed.push(path); return true }
    })
    expect(result).toBe('D:\\msys64\\usr\\bin\\bash.exe')
    expect(probed).toEqual(['D:\\msys64\\usr\\bin\\bash.exe'])
  })

  it('显式路径探测失败时按 Git Bash → PATH 顺序继续', () => {
    const result = resolveBashPath({
      platform: 'win32',
      env: win32Env,
      explicitPath: 'C:\\bad\\bash.exe',
      exists: allExist,
      probe: (path) => !path.startsWith('C:\\bad')
    })
    expect(result).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
  })

  it('全部候选探测失败（如只有 WSL stub）返回 null', () => {
    const result = resolveBashPath({ platform: 'win32', env: win32Env, exists: allExist, probe: fail })
    expect(result).toBeNull()
  })

  it('不存在的候选不进入探测', () => {
    const probed: string[] = []
    resolveBashPath({
      platform: 'win32',
      env: win32Env,
      // 只有 System32 下的文件「存在」，模拟没装 Git Bash、PATH 上只有 WSL stub 的机器。
      exists: (path) => path.includes('System32'),
      probe: (path) => { probed.push(path); return false }
    })
    expect(probed).toEqual(['C:\\Windows\\System32\\bash.exe'])
  })

  it('同进程内缓存探测结果，显式路径变化时重新探测', () => {
    let calls = 0
    const probe = () => { calls += 1; return true }
    const base = { platform: 'win32' as const, env: win32Env, exists: allExist, probe }
    resolveBashPath(base)
    resolveBashPath(base)
    expect(calls).toBe(1)
    resolveBashPath({ ...base, explicitPath: 'D:\\other\\bash.exe' })
    expect(calls).toBe(2)
  })
})

describe('resolveShellToolName', () => {
  it('用户明确选 powershell 时始终用 powershell', () => {
    expect(resolveShellToolName('powershell', { platform: 'win32', env: win32Env, exists: allExist, probe: ok })).toBe('powershell')
    expect(resolveShellToolName('powershell', { platform: 'linux', env: {}, exists: allExist, probe: fail })).toBe('powershell')
  })

  it('非 Windows 平台固定 bash', () => {
    expect(resolveShellToolName('bash', { platform: 'darwin', env: {}, exists: allExist, probe: fail })).toBe('bash')
  })

  it('Windows 上找到可用 bash 用 bash', () => {
    expect(resolveShellToolName('bash', { platform: 'win32', env: win32Env, exists: allExist, probe: ok })).toBe('bash')
  })

  it('Windows 上找不到可用 bash 时降级 powershell', () => {
    expect(resolveShellToolName('bash', { platform: 'win32', env: win32Env, exists: allExist, probe: fail })).toBe('powershell')
  })
})

describe('内置 bash', () => {
  const bundled = 'C:\\Users\\me\\.fa\\runtime\\git\\usr\\bin\\bash.exe'

  it('排在系统 Git Bash 之前：装了 FastAgent 就有 bash，不看用户环境', () => {
    const probed: string[] = []
    const result = resolveBashPath({
      platform: 'win32', env: win32Env, bundledPath: bundled,
      exists: allExist, probe: (path) => { probed.push(path); return true }
    })
    expect(result).toBe(bundled)
    expect(probed).toEqual([bundled])
  })

  it('用户显式指定时仍以显式路径为准', () => {
    const result = resolveBashPath({
      platform: 'win32', env: win32Env, explicitPath: 'D:\\msys64\\usr\\bin\\bash.exe',
      bundledPath: bundled, exists: allExist, probe: ok
    })
    expect(result).toBe('D:\\msys64\\usr\\bin\\bash.exe')
  })

  it('内置 bash 探测不通过时继续往系统候选回落', () => {
    const result = resolveBashPath({
      platform: 'win32', env: win32Env, bundledPath: bundled,
      exists: allExist, probe: (path) => path !== bundled
    })
    expect(result).not.toBe(bundled)
    expect(result).toBeTruthy()
  })

  it('有内置 bash 时不会降级到 PowerShell', () => {
    expect(resolveShellToolName('bash', {
      platform: 'win32', env: { PATH: '' }, bundledPath: bundled, exists: allExist, probe: ok
    })).toBe('bash')
  })

  it('用户明确选 PowerShell 时内置 bash 不覆盖这个选择', () => {
    expect(resolveShellToolName('powershell', {
      platform: 'win32', env: win32Env, bundledPath: bundled, exists: allExist, probe: ok
    })).toBe('powershell')
  })
})
