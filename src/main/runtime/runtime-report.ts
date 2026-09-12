import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeReport, RuntimeToolInfo } from '../../shared/types'
import { INSTALLED_MANIFEST_FILE, RUNTIME_NOTICES_FILE, parseRuntimeManifest, type RuntimeManifest, type RuntimeToolEntry } from './bundled-tools'

/** 单个工具的落地情况；由调用方从文件系统采集，分类逻辑保持纯函数便于测试。 */
export interface RuntimeToolProbe {
  exists: boolean
  /** 只有在做完整性校验时才算，未校验为 null */
  sha256: string | null
}

/**
 * 落地情况 → 展示状态。
 * 未校验时只看文件在不在：算 sha256 要把 MinGit 那种上百 MB 的树全读一遍，不能每次开页面都做。
 */
export function classifyRuntimeTool(id: string, entry: RuntimeToolEntry, probe: RuntimeToolProbe, path: string): RuntimeToolInfo {
  if (!probe.exists) {
    return { id, version: entry.version, source: 'missing', status: 'missing', path: null, detail: '文件缺失，可尝试修复' }
  }
  if (probe.sha256 !== null && probe.sha256 !== entry.sha256) {
    return { id, version: entry.version, source: 'bundled', status: 'mismatch', path, detail: '内容与清单不一致，建议修复' }
  }
  return { id, version: entry.version, source: 'bundled', status: 'ready', path }
}

/** 整份报告的排序：有问题的排前面，其余按清单顺序，免得用户在一长串 ready 里找那一条红的。 */
export function sortRuntimeTools(tools: readonly RuntimeToolInfo[]): RuntimeToolInfo[] {
  const weight = (tool: RuntimeToolInfo) => (tool.status === 'ready' ? 1 : 0)
  return [...tools].sort((a, b) => weight(a) - weight(b))
}

function sha256File(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

/**
 * 采集一份 Runtime 报告。verify 为 true 时逐个算 sha256 与清单比对。
 * 清单读不出来说明这台机器压根没装过内置工具链，返回空清单而不是报错。
 */
export function buildRuntimeReport(options: { installDir: string; verify?: boolean; now?: number }): RuntimeReport {
  const manifestPath = join(options.installDir, INSTALLED_MANIFEST_FILE)
  const manifest: RuntimeManifest | null = existsSync(manifestPath)
    ? parseRuntimeManifest(readFileSync(manifestPath, 'utf-8'))
    : null
  const checkedAt = options.now ?? Date.now()
  const noticesPath = join(options.installDir, RUNTIME_NOTICES_FILE)
  const noticesFile = existsSync(noticesPath) ? noticesPath : null
  if (!manifest) {
    return { runtimeVersion: null, installDir: options.installDir, checkedAt, verified: Boolean(options.verify), noticesFile, tools: [] }
  }
  const tools = Object.entries(manifest.tools).map(([id, entry]) => {
    const path = join(options.installDir, ...entry.path.split('/'))
    const exists = existsSync(path)
    return classifyRuntimeTool(id, entry, { exists, sha256: exists && options.verify ? sha256File(path) : null }, path)
  })
  return {
    runtimeVersion: manifest.runtimeVersion,
    installDir: options.installDir,
    checkedAt,
    verified: Boolean(options.verify),
    noticesFile,
    tools: sortRuntimeTools(tools)
  }
}
