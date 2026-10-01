import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'
import type { LocalMcpServer, LocalMcpServerInput, McpConnectionSnapshot } from '../../shared/types'
import { emptyConnectionSnapshot, parseJson } from './row-mappers'

/** 本地 MCP Server 配置、连接状态缓存与工具启停。 */
export class McpStore {
  constructor(private readonly db: Database.Database) {}

  listMcpServers(): LocalMcpServer[] {
    const rows = this.db.prepare('SELECT id, payload, secrets FROM local_mcp_servers ORDER BY updated_at ASC, id ASC').all() as Array<{ id: string; payload: string; secrets: Buffer | null }>
    return rows.map((row) => ({ ...parseJson<Omit<LocalMcpServer, 'hasSecrets'>>(row.payload, {} as Omit<LocalMcpServer, 'hasSecrets'>), id: row.id, hasSecrets: Boolean(row.secrets) }))
  }

  saveMcpServer(input: LocalMcpServerInput): LocalMcpServer {
    const existing = this.db.prepare('SELECT secrets FROM local_mcp_servers WHERE id = ?').get(input.id) as { secrets: Buffer | null } | undefined
    const secretInputProvided = input.env !== undefined || input.headers !== undefined
    const secrets = { env: input.env ?? {}, headers: input.headers ?? {} }
    let encrypted = existing?.secrets ?? null
    if (secretInputProvided) {
      const hasSecrets = Object.keys(secrets.env).length > 0 || Object.keys(secrets.headers).length > 0
      if (hasSecrets && !safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，不能保存 MCP 密钥')
      encrypted = hasSecrets ? safeStorage.encryptString(JSON.stringify(secrets)) : null
    }
    const { env: _env, headers: _headers, ...publicPayload } = input
    this.db.prepare(`
      INSERT INTO local_mcp_servers(id, payload, secrets, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, secrets = excluded.secrets, updated_at = excluded.updated_at
    `).run(input.id, JSON.stringify(publicPayload), encrypted, new Date().toISOString())
    return this.listMcpServers().find((item) => item.id === input.id) as LocalMcpServer
  }

  setMcpServerEnabled(id: string, enabled: boolean) {
    const current = this.listMcpServers().find((item) => item.id === id)
    if (!current) throw new Error(`MCP Server 不存在：${id}`)
    return this.saveMcpServer({ ...current, enabled })
  }

  listEnabledMcpRuntimeConfigs(): LocalMcpServerInput[] {
    return this.listMcpRuntimeConfigs().filter((config) => config.enabled)
  }

  getMcpRuntimeConfig(id: string): LocalMcpServerInput | null {
    return this.listMcpRuntimeConfigs().find((config) => config.id === id) ?? null
  }

  private listMcpRuntimeConfigs(): LocalMcpServerInput[] {
    const rows = this.db.prepare('SELECT id, payload, secrets FROM local_mcp_servers ORDER BY updated_at ASC, id ASC').all() as Array<{ id: string; payload: string; secrets: Buffer | null }>
    return rows.map((row) => {
      const payload = parseJson<Omit<LocalMcpServerInput, 'env' | 'headers'>>(row.payload, {} as Omit<LocalMcpServerInput, 'env' | 'headers'>)
      let secrets: { env?: Record<string, string>; headers?: Record<string, string> } = {}
      if (row.secrets) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error(`无法解密 MCP Server：${payload.name}`)
        secrets = parseJson(safeStorage.decryptString(row.secrets), {})
      }
      return { ...payload, id: row.id, env: secrets.env ?? {}, headers: secrets.headers ?? {} }
    })
  }

  removeMcpServer(id: string) {
    this.db.prepare('DELETE FROM local_mcp_servers WHERE id = ?').run(id)
  }

  /** MCP Server 行的 updated_at，用于 meta 回填的 installed_at。 */
  listMcpServerTimestamps(): Array<{ id: string; updatedAt: string }> {
    const rows = this.db.prepare('SELECT id, updated_at FROM local_mcp_servers').all() as Array<{ id: string; updated_at: string }>
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }))
  }

  listMcpStatus(): Array<{ serverId: string } & McpConnectionSnapshot> {
    const rows = this.db.prepare('SELECT server_id, payload FROM mcp_status_cache').all() as Array<{ server_id: string; payload: string }>
    return rows.map((row) => ({ serverId: row.server_id, ...parseJson<McpConnectionSnapshot>(row.payload, emptyConnectionSnapshot()) }))
  }

  getMcpStatus(serverId: string): McpConnectionSnapshot | null {
    const row = this.db.prepare('SELECT payload FROM mcp_status_cache WHERE server_id = ?').get(serverId) as { payload: string } | undefined
    return row ? parseJson<McpConnectionSnapshot>(row.payload, emptyConnectionSnapshot()) : null
  }

  /** 只落工具描述与错误文本；env/headers 一律不进这张表。 */
  setMcpStatus(serverId: string, snapshot: McpConnectionSnapshot) {
    const safe: McpConnectionSnapshot = {
      state: snapshot.state,
      testedAt: snapshot.testedAt,
      error: snapshot.error ?? null,
      toolCount: snapshot.toolCount,
      resourceCount: snapshot.resourceCount,
      promptCount: snapshot.promptCount,
      tools: snapshot.tools.map((tool) => ({ name: tool.name, description: tool.description, annotations: tool.annotations }))
    }
    this.db.prepare(`
      INSERT INTO mcp_status_cache(server_id, payload, tested_at) VALUES (?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET payload = excluded.payload, tested_at = excluded.tested_at
    `).run(serverId, JSON.stringify(safe), safe.testedAt ?? new Date().toISOString())
    return safe
  }

  removeMcpStatus(serverId: string) {
    this.db.prepare('DELETE FROM mcp_status_cache WHERE server_id = ?').run(serverId)
  }

  /**
   * 单台 Server 上被显式禁用的工具名。默认不落行，缺行即启用——
   * Server 侧新增工具时不应因为本地没有记录就被静默屏蔽。
   */
  listDisabledMcpTools(serverId: string): string[] {
    const rows = this.db.prepare('SELECT tool_name FROM mcp_tool_state WHERE server_id = ? AND enabled = 0').all(serverId) as Array<{ tool_name: string }>
    return rows.map((row) => row.tool_name)
  }

  listAllDisabledMcpTools(): Array<{ serverId: string; toolName: string }> {
    const rows = this.db.prepare('SELECT server_id, tool_name FROM mcp_tool_state WHERE enabled = 0').all() as Array<{ server_id: string; tool_name: string }>
    return rows.map((row) => ({ serverId: row.server_id, toolName: row.tool_name }))
  }

  setMcpToolEnabled(serverId: string, toolName: string, enabled: boolean) {
    this.db.prepare(`
      INSERT INTO mcp_tool_state(server_id, tool_name, enabled) VALUES (?, ?, ?)
      ON CONFLICT(server_id, tool_name) DO UPDATE SET enabled = excluded.enabled
    `).run(serverId, toolName, enabled ? 1 : 0)
  }

  removeMcpToolState(serverId: string) {
    this.db.prepare('DELETE FROM mcp_tool_state WHERE server_id = ?').run(serverId)
  }
}
