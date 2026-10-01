import type Database from 'better-sqlite3'
import { createArtifactId, inferArtifactType } from '../../shared/artifact'
import { stripEventExecutions } from '../turn-activity'
import { defaultRuntimeConfig } from './row-mappers'

/**
 * 成果版本恢复要的是「本轮第一次写之前的原文」。旧库没有这一列，补上即可，
 * 历史回合无法追溯原文，界面按 canRestore=false 处理。
 */
export function ensureFileChangeBeforeText(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(agent_file_changes)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'before_text')) return
  db.exec('ALTER TABLE agent_file_changes ADD COLUMN before_text TEXT')
}

/**
 * 摘要来源列。旧库里的摘要都是按回合切出来的，默认 'turns' 与既有语义一致；
 * Pi 会话内压出来的摘要写 'session'，不能当作重开 session 的提示词种子。
 */
/** 会话级「压缩后目标占比」；旧库为空表示跟随策略默认值。 */
export function ensureContextPolicyTargetRatio(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(conversation_context_policy)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'target_ratio')) return
  db.exec('ALTER TABLE conversation_context_policy ADD COLUMN target_ratio REAL')
}

export function ensureSummarySourceColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(conversation_summaries)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'source')) return
  db.exec("ALTER TABLE conversation_summaries ADD COLUMN source TEXT NOT NULL DEFAULT 'turns'")
}

// 旧库的 conversations 表建于 project_id 之前，CREATE TABLE IF NOT EXISTS 不会补列。
export function ensureConversationProjectColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'project_id')) return
  db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT')
}

/** session 目录改成「用户/日期/会话」后需要的两列：路径里的用户段与一次性迁移的完成标记。 */
export function ensureAccountLayoutColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'username')) db.exec('ALTER TABLE accounts ADD COLUMN username TEXT')
  if (!columns.some((column) => column.name === 'session_layout_version')) db.exec('ALTER TABLE accounts ADD COLUMN session_layout_version INTEGER NOT NULL DEFAULT 0')
}

// 模型改为会话级绑定后新增的列，旧库同样需要补。
export function ensureConversationModelColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'model_id')) return
  db.exec('ALTER TABLE conversations ADD COLUMN model_id INTEGER')
}

// Hub 多源之后需要记「装自哪个源」，旧库的 ability_install_meta 建于该列之前。
export function ensureAbilityMetaSourceColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(ability_install_meta)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'source_id')) return
  db.exec('ALTER TABLE ability_install_meta ADD COLUMN source_id TEXT')
}

// 能力要在不打开 Hub 的情况下也知道有没有新版，旧库的 ability_install_meta 建于这两列之前。
export function ensureAbilityMetaLatestColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(ability_install_meta)').all() as Array<{ name: string }>
  for (const column of ['latest_version', 'latest_checked_at']) {
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ability_install_meta ADD COLUMN ${column} TEXT`)
  }
}

export function ensureToolCallSubAgentColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(tool_calls)').all() as Array<{ name: string }>
  for (const column of ['parent_tool_call_id', 'sub_agent_id', 'sub_agent_run_id']) {
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE tool_calls ADD COLUMN ${column} TEXT`)
  }
}

export function ensureToolCallSourceColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(tool_calls)').all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === 'source')) db.exec('ALTER TABLE tool_calls ADD COLUMN source TEXT')
}

// conversation_turns.status 的 CHECK 约束在引入 interrupted 终态前不含该项；
// CREATE TABLE IF NOT EXISTS 不会更新已有表的约束，需要整表重建并保留数据。
export function ensureTurnStatusInterrupted(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_turns'").get() as { sql: string } | undefined
  if (!row || row.sql.includes("'interrupted'")) return
  const rebuild = db.transaction(() => {
    db.exec(`
        ALTER TABLE conversation_turns RENAME TO conversation_turns_old;
        CREATE TABLE conversation_turns (
          namespace TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          turn_id TEXT NOT NULL,
          user_message TEXT NOT NULL,
          attachments TEXT NOT NULL DEFAULT '[]',
          activity TEXT,
          assistant_message TEXT,
          citations TEXT NOT NULL DEFAULT '[]',
          artifacts TEXT NOT NULL DEFAULT '[]',
          runtime_config TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL CHECK(status IN ('working', 'completed', 'failed', 'cancelled', 'interrupted')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(namespace, turn_id),
          FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
        );
        INSERT INTO conversation_turns (namespace, conversation_id, turn_id, user_message, attachments, activity, assistant_message, citations, artifacts, runtime_config, status, created_at, updated_at)
          SELECT namespace, conversation_id, turn_id, user_message, attachments, activity, assistant_message, citations, artifacts, runtime_config, status, created_at, updated_at FROM conversation_turns_old;
        DROP TABLE conversation_turns_old;
        CREATE INDEX IF NOT EXISTS conversation_turns_order
          ON conversation_turns(namespace, conversation_id, created_at, turn_id);
      `)
  })
  rebuild()
}

/** 失败归类与自动重试计数：用来回答「为什么停了」「重试过几次」。 */
export function ensureAgentRunDiagnosticColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'error_kind')) db.exec('ALTER TABLE agent_runs ADD COLUMN error_kind TEXT')
  if (!columns.some((column) => column.name === 'retry_count')) db.exec('ALTER TABLE agent_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0')
}

/** Plan 分层引入的三列：阶段名、阶段序、委派出去的子任务 id。 */
export function ensureTodoPlanColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(session_todos)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'phase')) db.exec('ALTER TABLE session_todos ADD COLUMN phase TEXT')
  if (!columns.some((column) => column.name === 'phase_position')) db.exec('ALTER TABLE session_todos ADD COLUMN phase_position INTEGER NOT NULL DEFAULT 0')
  if (!columns.some((column) => column.name === 'delegated_task_id')) db.exec('ALTER TABLE session_todos ADD COLUMN delegated_task_id TEXT')
}

/**
 * session_todos.status 的 CHECK 建于 blocked / failed / skipped 三态之前。
 * 与 ensureTurnStatusInterrupted 同理：CREATE TABLE IF NOT EXISTS 不改已有表的约束，只能整表重建。
 * 重建放在补列之后，因此新表直接带上三个新列，数据按列名逐一搬。
 */
export function ensureTodoStatusExtended(db: Database.Database) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'session_todos'").get() as { sql: string } | undefined
  if (!row || row.sql.includes("'blocked'")) return
  const rebuild = db.transaction(() => {
    db.exec(`
        ALTER TABLE session_todos RENAME TO session_todos_old;
        CREATE TABLE session_todos (
          namespace TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending','in_progress','completed','cancelled','blocked','failed','skipped')),
          position INTEGER NOT NULL,
          phase TEXT,
          phase_position INTEGER NOT NULL DEFAULT 0,
          delegated_task_id TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(namespace, conversation_id, item_id),
          FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
        );
        INSERT INTO session_todos (namespace, conversation_id, item_id, content, status, position, phase, phase_position, delegated_task_id, updated_at)
          SELECT namespace, conversation_id, item_id, content, status, position, phase, phase_position, delegated_task_id, updated_at FROM session_todos_old;
        DROP TABLE session_todos_old;
      `)
  })
  rebuild()
}

/** conversation_messages 时代的历史记录按「用户消息开启一轮、助手消息收尾」重建成 turns。 */
export function migrateLegacyMessages(db: Database.Database) {
  const conversations = db.prepare('SELECT namespace, conversation_id FROM conversations').all() as Array<{ namespace: string; conversation_id: string }>
  const insert = db.prepare(`INSERT INTO conversation_turns(namespace, conversation_id, turn_id, user_message, attachments, activity, assistant_message, citations, artifacts, runtime_config, status, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', NULL, ?, '[]', '[]', ?, ?, ?, ?)`)
  const update = db.prepare('UPDATE conversation_turns SET assistant_message = ?, status = ?, updated_at = ? WHERE namespace = ? AND turn_id = ?')
  const migrate = db.transaction(() => {
    for (const conversation of conversations) {
      const hasTurns = db.prepare('SELECT 1 FROM conversation_turns WHERE namespace = ? AND conversation_id = ? LIMIT 1').get(conversation.namespace, conversation.conversation_id)
      if (hasTurns) continue
      const messages = db.prepare('SELECT message_id, role, text, created_at FROM conversation_messages WHERE namespace = ? AND conversation_id = ? ORDER BY created_at ASC, message_id ASC').all(conversation.namespace, conversation.conversation_id) as Array<{ message_id: string; role: 'user' | 'assistant'; text: string; created_at: string }>
      let currentTurnId: string | null = null
      for (const message of messages) {
        if (message.role === 'user') {
          currentTurnId = `turn-legacy-${message.message_id}`
          insert.run(conversation.namespace, conversation.conversation_id, currentTurnId, JSON.stringify({ text: message.text, createdAt: message.created_at }), null, JSON.stringify(defaultRuntimeConfig()), 'working', message.created_at, message.created_at)
        } else if (currentTurnId) {
          update.run(JSON.stringify({ text: message.text, createdAt: message.created_at }), 'completed', message.created_at, conversation.namespace, currentTurnId)
        }
      }
    }
  })
  migrate()
}

/**
 * session 从「按模型分桶」改为「按会话唯一」后，旧库里每个会话可能存着多份 per-model session。
 * 取最近更新且非空的一份提升为会话级 session，其余留在磁盘不动：换模型继续对话时才能接上历史。
 * 会话级 session_file 已有值的不覆盖，迁移只跑一次有效。
 */
export function migrateModelSessionToConversation(db: Database.Database) {
  const rows = db.prepare(`
      SELECT namespace, conversation_id, session_file FROM conversation_model_runtime AS runtime
      WHERE session_file IS NOT NULL AND session_file <> ''
        AND NOT EXISTS (
          SELECT 1 FROM conversations
          WHERE conversations.namespace = runtime.namespace AND conversations.conversation_id = runtime.conversation_id
            AND conversations.session_file IS NOT NULL AND conversations.session_file <> ''
        )
      ORDER BY updated_at DESC, rowid DESC
    `).all() as Array<{ namespace: string; conversation_id: string; session_file: string }>
  if (!rows.length) return
  const seen = new Set<string>()
  const migrate = db.transaction(() => {
    const statement = db.prepare('UPDATE conversations SET session_file = ? WHERE namespace = ? AND conversation_id = ?')
    for (const row of rows) {
      const key = `${row.namespace}\t${row.conversation_id}`
      if (seen.has(key)) continue
      seen.add(key)
      statement.run(row.session_file, row.namespace, row.conversation_id)
    }
  })
  migrate()
}

/**
 * 历史 activity 里每条事件都存了一份整轮执行快照，重复量占到九成以上字节。
 * 顶层 activity.execution 保留，只清事件副本；读取侧从来不看这份重复数据。
 */
export function stripEventExecutionSnapshots(db: Database.Database) {
  const rows = db.prepare("SELECT namespace, turn_id, activity FROM conversation_turns WHERE activity LIKE '%\"execution\"%'").all() as Array<{ namespace: string; turn_id: string; activity: string }>
  if (!rows.length) return
  const update = db.prepare('UPDATE conversation_turns SET activity = ? WHERE namespace = ? AND turn_id = ?')
  const migrate = db.transaction(() => {
    for (const row of rows) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row.activity)
      } catch {
        continue
      }
      const { activity, stripped } = stripEventExecutions(parsed)
      if (stripped) update.run(JSON.stringify(activity), row.namespace, row.turn_id)
    }
  })
  migrate()
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 工作区根之下才算产物。迁移阶段只做字符串判断，不碰文件系统：
 * 历史回合的项目目录可能早就不在了，realpath 会抛错也会拖慢启动。
 * Windows 上盘符大小写不稳定，前缀比较忽略大小写，相对路径仍取原样。
 */
function relativeInsideRoot(root: string, target: string): string | null {
  const normalizedRoot = toPosixPath(root)
  const normalizedTarget = toPosixPath(target)
  if (!normalizedRoot || !normalizedTarget) return null
  const prefix = `${normalizedRoot}/`
  if (!normalizedTarget.toLowerCase().startsWith(prefix.toLowerCase())) return null
  return normalizedTarget.slice(prefix.length) || null
}

/**
 * 历史回合里的 file_changed 事件补登记成 Artifact。
 * 登记逻辑此前用错了路径守卫（只认相对路径），模型给的绝对路径全被静默丢掉，
 * 面板因此长期是空的；事件本身一直在 activity 里，可以照着补回来。
 * 全表扫 conversation_turns，只能跑一次，靠 user_version 门控。
 */
export function backfillArtifactsFromTurnEvents(db: Database.Database) {
  const rows = db.prepare(`
      SELECT namespace, conversation_id, turn_id, activity, runtime_config, updated_at
      FROM conversation_turns WHERE activity IS NOT NULL
    `).all() as Array<{ namespace: string; conversation_id: string; turn_id: string; activity: string; runtime_config: string; updated_at: string }>
  if (!rows.length) return

  type Pending = { namespace: string; workspaceId: string; conversationId: string; turnId: string; path: string; name: string; source: string; createdAt: number; updatedAt: number }
  const pending = new Map<string, Pending>()
  for (const row of rows) {
    let root: string | null = null
    let events: Array<{ type?: string; path?: string; detail?: string; timestamp?: number }> = []
    try {
      root = (JSON.parse(row.runtime_config) as { project?: string | null }).project ?? null
      events = (JSON.parse(row.activity) as { events?: typeof events }).events ?? []
    } catch {
      continue
    }
    if (!root) continue
    const fallbackAt = Date.parse(row.updated_at) || 0
    for (const event of events) {
      if (event.type !== 'file_changed' || !event.path) continue
      const relative = relativeInsideRoot(root, event.path)
      if (!relative) continue
      const key = `${row.namespace}\u0000${root}\u0000${relative}\u0000${row.conversation_id}`
      const at = event.timestamp ?? fallbackAt
      const existing = pending.get(key)
      if (!existing) {
        pending.set(key, {
          namespace: row.namespace,
          workspaceId: root,
          conversationId: row.conversation_id,
          turnId: row.turn_id,
          path: relative,
          name: relative.split('/').pop() || relative,
          source: event.detail || 'write',
          createdAt: at,
          updatedAt: at
        })
        continue
      }
      existing.createdAt = Math.min(existing.createdAt, at)
      // 同一路径保留最近一次写入的归属回合与来源工具
      if (at >= existing.updatedAt) {
        existing.updatedAt = at
        existing.turnId = row.turn_id
        existing.source = event.detail || existing.source
      }
    }
  }
  if (!pending.size) return

  const lookup = db.prepare('SELECT 1 FROM artifacts WHERE namespace = ? AND workspace_id = ? AND path IS ? AND conversation_id IS ? LIMIT 1')
  const insert = db.prepare(`
      INSERT INTO artifacts(namespace, artifact_id, workspace_id, conversation_id, task_id, agent_run_id, turn_id, name, type, path, content, size, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
    `)
  const migrate = db.transaction(() => {
    for (const item of pending.values()) {
      // 修复上线后新登记的记录带着真实 size，不能被回填覆盖掉
      if (lookup.get(item.namespace, item.workspaceId, item.path, item.conversationId)) continue
      insert.run(
        item.namespace, createArtifactId(), item.workspaceId, item.conversationId, item.turnId,
        item.name, inferArtifactType(item.name), item.path, item.source, item.createdAt, item.updatedAt
      )
    }
  })
  migrate()
}

/**
 * 当前 schema 版本。迁移全部是幂等的，但 migrateLegacyMessages、
 * migrateModelSessionToConversation 与 backfillArtifactsFromTurnEvents 每次都要全表扫，
 * 库大了就是白付的启动开销。跑完记在 user_version 上，之后启动直接跳过；
 * 旧库 user_version 为 0，仍会补跑一次。
 */
export const SCHEMA_VERSION = 5
