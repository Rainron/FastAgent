import type { LocalMcpServerInput } from '../shared/types'

export type McpImportSource = Record<string, unknown>

function toConfigList(source: McpImportSource): Array<{ name: string; config: Record<string, unknown> }> {
  if (Array.isArray(source)) {
    return source.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
      return typeof record.name === 'string' && record.name.trim() ? [{ name: record.name.trim(), config: record }] : []
    })
  }
  for (const key of ['servers', 'mcpServers']) {
    const group = source[key]
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      return Object.entries(group as Record<string, unknown>).flatMap(([name, config]) =>
        config && typeof config === 'object' ? [{ name, config: config as Record<string, unknown> }] : [])
    }
  }
  if (typeof source.name === 'string' && source.name.trim()) return [{ name: source.name.trim(), config: source }]
  return []
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
}

function toStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean)
  return undefined
}

function toRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') record[key] = item
  }
  return Object.keys(record).length ? record : undefined
}

function toServerInput(name: string, config: Record<string, unknown>): LocalMcpServerInput {
  const id = slug(name) || slug('server')
  const hasUrl = typeof config.url === 'string' && config.url.trim().length > 0
  const transport = config.transport === 'streamable_http' || hasUrl ? 'streamable_http' : 'stdio'
  const input: LocalMcpServerInput = {
    id,
    name,
    transport,
    enabled: config.enabled !== false,
    timeoutMs: typeof config.timeoutMs === 'number' && config.timeoutMs > 0 ? config.timeoutMs
      : typeof config.timeout_seconds === 'number' && config.timeout_seconds > 0 ? Math.round(config.timeout_seconds * 1000)
        : 10000
  }
  const env = toRecord(config.env)
  const headers = toRecord(config.headers)
  if (env) input.env = env
  if (headers) input.headers = headers
  if (transport === 'stdio') {
    if (typeof config.command === 'string' && config.command.trim()) input.command = config.command.trim()
    const args = toStringList(config.args)
    if (args && args.length) input.args = args
    if (typeof config.cwd === 'string' && config.cwd.trim()) input.cwd = config.cwd.trim()
  } else {
    if (typeof config.url === 'string' && config.url.trim()) input.url = config.url.trim()
  }
  return input
}

/** 把 claude 风格 / 数组 / 单对象格式的 MCP JSON 配置解析为可保存的 Server 输入。 */
export function parseMcpImport(raw: string): LocalMcpServerInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('导入文件不是有效的 JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('导入文件不是有效的 MCP Server 配置')
  }
  const entries = toConfigList(parsed as McpImportSource)
  if (!entries.length) throw new Error('导入文件里没有可识别的 Server 配置')
  return entries.map(({ name, config }) => toServerInput(name, config))
}