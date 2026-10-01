import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

function channels(files: string[], pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const file of files) for (const match of readFileSync(file, 'utf8').matchAll(pattern)) found.add(match[1])
  return found
}

/**
 * 通道名在 preload 与主进程两边各写一遍，改名只改一边时类型检查拦不住：
 * 渲染进程拿到「No handler registered」，调用点若再吞掉错误，功能就静默失效。
 */
describe('IPC 通道一致性', () => {
  it('preload 调用的每个 invoke 通道在主进程都有注册', () => {
    const invoked = channels(sourceFiles(join(SRC, 'preload')), /ipcRenderer\.invoke\(\s*'([^']+)'/g)
    const handled = channels(sourceFiles(join(SRC, 'main')), /\bhandle\(\s*'([^']+)'/g)
    expect(invoked.size).toBeGreaterThan(0)
    expect([...invoked].filter((channel) => !handled.has(channel))).toEqual([])
  })
})
