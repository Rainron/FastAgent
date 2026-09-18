import type Database from 'better-sqlite3'
import { createArtifactId, inferArtifactType } from '../../shared/artifact'
import { stripEventExecutions } from '../turn-activity'
import { defaultRuntimeConfig } from './row-mappers'
import { migrateSharedWorkspace, WORKSPACE_SCHEMA_SQL } from './shared-workspace'
import { MODEL_CONNECTIONS_SQL, migrateLegacyLocalModels } from './model-connections'
import { MODEL_USAGE_SCHEMA_SQL } from '../model-usage-store'

/** 建库 DDL：全部 IF NOT EXISTS，已有库重复执行无副作用；补列与改约束走下面的迁移函数。 */
export const SCHEMA_SQL = `
      ${WORKSPACE_SCHEMA_SQL}
      ${MODEL_CONNECTIONS_SQL}
      ${MODEL_USAGE_SCHEMA_SQL}
      CREATE TABLE IF NOT EXISTS accounts (
        namespace TEXT PRIMARY KEY,
        backend_url TEXT NOT NULL,
        user_id TEXT NOT NULL,
        refresh_token BLOB,
        username TEXT,
        session_layout_version INTEGER NOT NULL DEFAULT 0,
        locked INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS resource_cache (
        namespace TEXT NOT NULL,
        kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, kind, resource_id)
      );
      CREATE TABLE IF NOT EXISTS model_credentials (
        namespace TEXT NOT NULL,
        model_id INTEGER NOT NULL,
        payload BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, model_id)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        session_file TEXT,
        project_id TEXT,
        model_id INTEGER,
        PRIMARY KEY(namespace, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_run_states (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        project_id TEXT,
        status TEXT NOT NULL,
        unread INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, conversation_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS conversation_messages (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(namespace, message_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS conversation_messages_order
        ON conversation_messages(namespace, conversation_id, created_at, message_id);
      CREATE TABLE IF NOT EXISTS conversation_turns (
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
        status TEXT NOT NULL CHECK(status IN ('working', 'completed', 'failed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, turn_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS conversation_turns_order
        ON conversation_turns(namespace, conversation_id, created_at, turn_id);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS client_preferences (
        scope TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_skill_state (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_mcp_servers (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        secrets BLOB,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        secrets BLOB,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ability_install_meta (
        ability_type TEXT NOT NULL,
        ability_id   TEXT NOT NULL,
        source       TEXT NOT NULL,
        plugin_id    TEXT,
        version      TEXT,
        installed_at TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        last_used_at TEXT,
        use_count    INTEGER NOT NULL DEFAULT 0,
        latest_version TEXT,
        latest_checked_at TEXT,
        PRIMARY KEY(ability_type, ability_id)
      );
      CREATE TABLE IF NOT EXISTS mcp_status_cache (
        server_id TEXT PRIMARY KEY,
        payload   TEXT NOT NULL,
        tested_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ability_sources (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        secrets    BLOB,
        enabled    INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_tool_state (
        server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        enabled   INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(server_id, tool_name)
      );
      CREATE TABLE IF NOT EXISTS local_cli_tools (
        id         TEXT PRIMARY KEY,
        payload    TEXT NOT NULL,
        check_result TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_context_policy (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        strategy TEXT NOT NULL CHECK(strategy IN ('auto', 'conservative', 'aggressive', 'disabled')),
        auto_summary INTEGER NOT NULL,
        trigger_ratio REAL,
        keep_recent_turns INTEGER,
        inherit_global INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(namespace, conversation_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS conversation_context_state (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        context_window INTEGER NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        message_tokens INTEGER NOT NULL,
        tool_tokens INTEGER NOT NULL,
        system_tokens INTEGER NOT NULL,
        compaction_count INTEGER NOT NULL DEFAULT 0,
        latest_summary_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, conversation_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS conversation_model_runtime (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_id INTEGER NOT NULL,
        session_file TEXT,
        context_window INTEGER NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        message_tokens INTEGER NOT NULL,
        tool_tokens INTEGER NOT NULL,
        system_tokens INTEGER NOT NULL,
        summary_tokens INTEGER NOT NULL DEFAULT 0,
        attachment_tokens INTEGER NOT NULL DEFAULT 0,
        counting_method TEXT NOT NULL DEFAULT 'fallback-estimate',
        compaction_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, conversation_id, provider, model_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        namespace TEXT NOT NULL,
        id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        summary_text TEXT NOT NULL,
        covered_turn_start TEXT,
        covered_turn_end TEXT,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(namespace, id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS conversation_summaries_order
        ON conversation_summaries(namespace, conversation_id, version DESC, created_at DESC);
      CREATE TABLE IF NOT EXISTS conversation_compactions (
        namespace TEXT NOT NULL,
        id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        strategy TEXT NOT NULL CHECK(strategy IN ('auto', 'conservative', 'aggressive', 'disabled')),
        trigger_reason TEXT NOT NULL,
        before_tokens INTEGER NOT NULL,
        after_tokens INTEGER NOT NULL,
        covered_turn_start TEXT,
        covered_turn_end TEXT,
        summary_id TEXT,
        duration_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(namespace, id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS conversation_compactions_order
        ON conversation_compactions(namespace, conversation_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS projects (
        namespace TEXT NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'calm',
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, project_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS projects_path ON projects(namespace, path);
      CREATE TABLE IF NOT EXISTS tool_calls (
        namespace TEXT NOT NULL,
        id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        source TEXT,
        arguments_json TEXT NOT NULL,
        result_json TEXT,
        status TEXT NOT NULL CHECK(status IN ('waiting_permission','running','success','failed','denied','cancelled','timeout')),
        permission_result TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        error TEXT,
        parent_tool_call_id TEXT,
        sub_agent_id TEXT,
        sub_agent_run_id TEXT,
        PRIMARY KEY(namespace, id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS tool_calls_turn ON tool_calls(namespace, turn_id, started_at);
      CREATE TABLE IF NOT EXISTS session_todos (
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
      CREATE TABLE IF NOT EXISTS permission_profiles (
        namespace TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        label TEXT NOT NULL,
        hint TEXT NOT NULL DEFAULT '',
        base TEXT NOT NULL CHECK(base IN ('ask','workspace','full')),
        builtin INTEGER NOT NULL DEFAULT 0,
        overrides TEXT NOT NULL DEFAULT '{}',
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, profile_id)
      );
      CREATE TABLE IF NOT EXISTS permission_rules (
        namespace TEXT NOT NULL,
        tool_key TEXT NOT NULL,
        pattern TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('allow','ask','deny')),
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, tool_key, pattern)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        namespace TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT,
        task_id TEXT,
        agent_run_id TEXT,
        turn_id TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT,
        content TEXT,
        size INTEGER,
        source TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, artifact_id)
      );
      CREATE INDEX IF NOT EXISTS artifacts_workspace_order
        ON artifacts(namespace, workspace_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS artifacts_conversation_order
        ON artifacts(namespace, conversation_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_file_changes (
        namespace TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        path TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        old_path TEXT,
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        tools TEXT NOT NULL DEFAULT '[]',
        before_hash TEXT,
        after_hash TEXT,
        diff TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, turn_id, path)
      );
      CREATE INDEX IF NOT EXISTS agent_file_changes_turn_order
        ON agent_file_changes(namespace, turn_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_runs (
        namespace TEXT NOT NULL,
        run_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','interrupted')),
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT,
        error_kind TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(namespace, run_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS agent_runs_conversation
        ON agent_runs(namespace, conversation_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS agent_runs_status
        ON agent_runs(namespace, status);
      CREATE TABLE IF NOT EXISTS agent_tasks (
        namespace TEXT NOT NULL,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        parent_tool_call_id TEXT,
        sub_agent_run_id TEXT,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled','timeout')),
        summary TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        duration_ms INTEGER,
        PRIMARY KEY(namespace, task_id),
        FOREIGN KEY(namespace, conversation_id) REFERENCES conversations(namespace, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS agent_tasks_run
        ON agent_tasks(namespace, run_id, started_at);
      CREATE INDEX IF NOT EXISTS agent_tasks_conversation
        ON agent_tasks(namespace, conversation_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS memories (
        namespace TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK(scope IN ('global','workspace','agent')),
        scope_id TEXT,
        type TEXT NOT NULL CHECK(type IN ('preference','fact','decision','experience')),
        content TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 3,
        confidence REAL NOT NULL DEFAULT 0.8,
        source_conversation_id TEXT,
        source_turn_id TEXT,
        source_run_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','deleted')),
        superseded_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER,
        expires_at INTEGER,
        PRIMARY KEY(namespace, memory_id)
      );
      CREATE INDEX IF NOT EXISTS memories_scope
        ON memories(namespace, scope, scope_id, status, importance DESC, updated_at DESC);
      /*
       * trigram 分词器：默认 unicode61 不切分中文，整句会成为一个 token，中文记忆完全检索不到。
       * 不能加 detail=none —— 超过 3 个字符的词（postgresql）会被切成多个 trigram，
       * 匹配它需要 phrase 查询，而 phrase 查询要求 detail=full。
       * 不用外部内容表：rowid 与 memories 对齐，写入侧在同一事务里同步两张表。
       */
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, tokenize='trigram');
    `

// 旧库的 conversations 表建于 project_id 之前，CREATE TABLE IF NOT EXISTS 不会补列。
function ensureConversationProjectColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'project_id')) return
  db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT')
}

/** session 目录改成「用户/日期/会话」后需要的两列：路径里的用户段与一次性迁移的完成标记。 */
function ensureAccountLayoutColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'username')) db.exec('ALTER TABLE accounts ADD COLUMN username TEXT')
  if (!columns.some((column) => column.name === 'session_layout_version')) db.exec('ALTER TABLE accounts ADD COLUMN session_layout_version INTEGER NOT NULL DEFAULT 0')
}

// 模型改为会话级绑定后新增的列，旧库同样需要补。
function ensureConversationModelColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'model_id')) return
  db.exec('ALTER TABLE conversations ADD COLUMN model_id INTEGER')
}

// Hub 多源之后需要记「装自哪个源」，旧库的 ability_install_meta 建于该列之前。
function ensureAbilityMetaSourceColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(ability_install_meta)').all() as Array<{ name: string }>
  if (columns.some((column) => column.name === 'source_id')) return
  db.exec('ALTER TABLE ability_install_meta ADD COLUMN source_id TEXT')
}

// 能力要在不打开 Hub 的情况下也知道有没有新版，旧库的 ability_install_meta 建于这两列之前。
function ensureAbilityMetaLatestColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(ability_install_meta)').all() as Array<{ name: string }>
  for (const column of ['latest_version', 'latest_checked_at']) {
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ability_install_meta ADD COLUMN ${column} TEXT`)
  }
}

function ensureToolCallSubAgentColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(tool_calls)').all() as Array<{ name: string }>
  for (const column of ['parent_tool_call_id', 'sub_agent_id', 'sub_agent_run_id']) {
    if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE tool_calls ADD COLUMN ${column} TEXT`)
  }
}

function ensureToolCallSourceColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(tool_calls)').all() as Array<{ name: string }>
  if (!columns.some((item) => item.name === 'source')) db.exec('ALTER TABLE tool_calls ADD COLUMN source TEXT')
}

// conversation_turns.status 的 CHECK 约束在引入 interrupted 终态前不含该项；
// CREATE TABLE IF NOT EXISTS 不会更新已有表的约束，需要整表重建并保留数据。
function ensureTurnStatusInterrupted(db: Database.Database) {
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
function ensureAgentRunDiagnosticColumns(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'error_kind')) db.exec('ALTER TABLE agent_runs ADD COLUMN error_kind TEXT')
  if (!columns.some((column) => column.name === 'retry_count')) db.exec('ALTER TABLE agent_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0')
}

/** Plan 分层引入的三列：阶段名、阶段序、委派出去的子任务 id。 */
function ensureTodoPlanColumns(db: Database.Database) {
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
function ensureTodoStatusExtended(db: Database.Database) {
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
function migrateLegacyMessages(db: Database.Database) {
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
function migrateModelSessionToConversation(db: Database.Database) {
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
function stripEventExecutionSnapshots(db: Database.Database) {
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
function backfillArtifactsFromTurnEvents(db: Database.Database) {
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
const SCHEMA_VERSION = 5

/**
 * 建表之后按固定顺序补列、改约束、迁移旧数据；顺序与建库时的调用顺序一致。
 *
 * 补列/改约束这批只做一次 PRAGMA table_info（或一次 sqlite_master 查询）就能判定是否需要动，
 * 开销与库大小无关，因此不受 user_version 门控——新增列才不必抬版本号去连带重跑下面的全表扫描。
 * user_version 门控的是真正按会话数线性增长的那两个迁移。
 */
export function applyMigrations(db: Database.Database) {
  ensureAccountLayoutColumns(db)
  ensureConversationProjectColumn(db)
  ensureConversationModelColumn(db)
  ensureToolCallSubAgentColumns(db)
  ensureToolCallSourceColumn(db)
  ensureAbilityMetaSourceColumn(db)
  ensureAbilityMetaLatestColumns(db)
  ensureTurnStatusInterrupted(db)
  // 补列必须在整表重建之前：重建时按列名搬数据，列不存在会直接报错。
  ensureTodoPlanColumns(db)
  ensureTodoStatusExtended(db)
  ensureAgentRunDiagnosticColumns(db)

  const [{ user_version: current }] = db.pragma('user_version') as Array<{ user_version: number }>
  if (current >= SCHEMA_VERSION) return
  // 逐档判断：抬版本号是为了跑新增的那一个迁移，不该把旧档的全表扫描一起再来一遍。
  if (current < 2) {
    migrateLegacyMessages(db)
    migrateModelSessionToConversation(db)
    backfillArtifactsFromTurnEvents(db)
  }
  if (current < 3) stripEventExecutionSnapshots(db)
  if (current < 4) migrateSharedWorkspace(db)
  if (current < 5) migrateLegacyLocalModels(db)
  db.pragma(`user_version = ${SCHEMA_VERSION}`)
}
