import type { PluginConfigField } from '../../shared/types'
import type { HubListingDetailDraft, InstallPayload } from './types'

/**
 * 官方 MCP Registry 的 server.json → 本地可安装形态。
 * 纯函数：输入一条 registry 记录，输出目录条目与安装载荷，不碰网络。
 *
 * schema: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
 */

interface RegistryVariable {
  name?: unknown
  description?: unknown
  isRequired?: unknown
  isSecret?: unknown
  value?: unknown
  default?: unknown
}

interface RegistryPackage {
  registryType?: unknown
  identifier?: unknown
  version?: unknown
  runtimeHint?: unknown
  transport?: { type?: unknown }
  environmentVariables?: unknown
  packageArguments?: unknown
  runtimeArguments?: unknown
}

interface RegistryRemote {
  type?: unknown
  url?: unknown
  headers?: unknown
}

export interface RegistryServerEntry {
  server?: {
    name?: unknown
    title?: unknown
    description?: unknown
    version?: unknown
    websiteUrl?: unknown
    repository?: { url?: unknown; source?: unknown }
    packages?: unknown
    remotes?: unknown
  }
  _meta?: Record<string, unknown>
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

/** npm / pypi 包名 → 本地启动命令。runtimeHint 优先，registryType 兜底。 */
function commandFor(pkg: RegistryPackage): { command: string; args: string[] } | null {
  const identifier = textOf(pkg.identifier)
  if (!identifier) return null
  const version = textOf(pkg.version)
  const spec = version ? `${identifier}@${version}` : identifier
  const hint = textOf(pkg.runtimeHint)
  if (hint) return { command: hint, args: [spec] }
  switch (pkg.registryType) {
    case 'npm': return { command: 'npx', args: ['-y', spec] }
    // uvx 接受 `name==version`，不是 npm 的 @ 语法。
    case 'pypi': return { command: 'uvx', args: [version ? `${identifier}==${version}` : identifier] }
    default: return null
  }
}

function fieldsFromVariables(variables: RegistryVariable[], target: 'env' | 'header'): PluginConfigField[] {
  return variables.flatMap((variable) => {
    const key = textOf(variable.name)
    if (!key) return []
    // 已经带了固定值且不是密钥的变量不需要问用户。
    const templated = typeof variable.value === 'string' && /\{[^}]+\}/.test(variable.value)
    if (variable.value !== undefined && !templated && variable.isSecret !== true) return []
    return [{
      key,
      label: key,
      target,
      required: variable.isRequired === true,
      secret: variable.isSecret === true,
      description: textOf(variable.description)
    }]
  })
}

export interface ParsedRegistryServer {
  detail: HubListingDetailDraft
  payloads: InstallPayload[]
}

/**
 * 一条 registry 记录可能同时给出远端与本地两种接法。优先 remotes：
 * 远端不需要在用户机器上跑进程，是风险更低的一侧。
 */
export function parseRegistryServer(entry: RegistryServerEntry): ParsedRegistryServer | null {
  const server = entry.server
  const name = textOf(server?.name)
  if (!server || !name) return null

  const remotes = listOf<RegistryRemote>(server.remotes)
  const packages = listOf<RegistryPackage>(server.packages)
  const displayName = textOf(server.title) ?? name.split('/').at(-1) ?? name
  const version = textOf(server.version) ?? '0.0.0'

  const remote = remotes.find((item) => item.type === 'streamable-http' || item.type === 'sse')
  const pkg = packages.find((item) => commandFor(item) !== null)

  let payload: InstallPayload | null = null
  let configFields: PluginConfigField[] = []

  if (remote && textOf(remote.url)) {
    payload = { kind: 'mcp', name: displayName, transport: 'streamable_http', url: textOf(remote.url) as string, timeoutMs: 10_000 }
    configFields = fieldsFromVariables(listOf<RegistryVariable>(remote.headers), 'header')
  } else if (pkg) {
    const resolved = commandFor(pkg) as { command: string; args: string[] }
    payload = { kind: 'mcp', name: displayName, transport: 'stdio', command: resolved.command, args: resolved.args, timeoutMs: 10_000 }
    configFields = fieldsFromVariables(listOf<RegistryVariable>(pkg.environmentVariables), 'env')
  }
  if (!payload) return null

  const stdio = payload.kind === 'mcp' && payload.transport === 'stdio'
  const publishedAt = textOf((entry._meta?.['io.modelcontextprotocol.registry/official'] as { publishedAt?: unknown } | undefined)?.publishedAt)
  return {
    payloads: [payload],
    detail: {
      // registry 的 name 已经是全局唯一的反域名标识，直接当 ref。
      ref: name,
      name,
      displayName,
      description: textOf(server.description) ?? '',
      abilityType: 'mcp',
      author: name.includes('/') ? name.split('/')[0] : undefined,
      version,
      categories: [],
      tags: [],
      publishedAt,
      homepage: textOf(server.websiteUrl),
      repository: textOf(server.repository?.url),
      permissions: {
        runsLocalCode: stdio,
        networkAccess: true,
        fileAccess: stdio,
        commands: stdio && payload.kind === 'mcp' && payload.command ? [[payload.command, ...(payload.args ?? [])].join(' ')] : undefined,
        envKeys: configFields.filter((field) => field.target === 'env').map((field) => field.key)
      },
      configFields,
      contents: [{ kind: 'mcp', name: displayName, description: textOf(server.description) }]
    }
  }
}

export function parseRegistryResponse(body: unknown): ParsedRegistryServer[] {
  const servers = listOf<RegistryServerEntry>((body as { servers?: unknown })?.servers)
  return servers.flatMap((entry) => {
    const parsed = parseRegistryServer(entry)
    return parsed ? [parsed] : []
  })
}
