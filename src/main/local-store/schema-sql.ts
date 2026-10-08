import { WORKSPACE_SCHEMA_SQL } from './shared-workspace'
import { MODEL_CONNECTIONS_SQL } from './model-connections'
import { MODEL_OVERRIDES_SQL } from './model-overrides-store'
import { MODEL_USAGE_SCHEMA_SQL } from '../model-usage-store'
import { KB_SCHEMA_SQL } from '../kb-store'

/** 建库 DDL：全部 IF NOT EXISTS，已有库重复执行无副作用；补列与改约束走下面的迁移函数。 */
export const SCHEMA_SQL = `
      ${WORKSPACE_SCHEMA_SQL}
      ${MODEL_CONNECTIONS_SQL}
      ${MODEL_OVERRIDES_SQL}
      ${MODEL_USAGE_SCHEMA_SQL}
      ${KB_SCHEMA_SQL}
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
        session_anchor TEXT,
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
      /* Skill 改写前的历史快照。与 local_skill_state 一样不分 namespace：
         Skill 装在数据根的 skills 目录里，本来就是跨账户共用的。 */
      CREATE TABLE IF NOT EXISTS skill_versions (
        name TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(name, revision)
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
        force_compaction INTEGER NOT NULL DEFAULT 0,
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
        source TEXT NOT NULL DEFAULT 'turns',
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
        context_window INTEGER NOT NULL DEFAULT 0,
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
      CREATE TABLE IF NOT EXISTS project_trust (
        namespace TEXT NOT NULL,
        trust_key TEXT NOT NULL,
        trusted INTEGER NOT NULL,
        display_path TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, trust_key)
      );
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
        before_text TEXT,
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
      /* 每轮召回命中落一张日志表：会话内闭环要求展示「这一轮注入了什么」，
         而召回本身不改动 memories 行，只能另存。clearMemories 物理删记忆时同步清理。 */
      CREATE TABLE IF NOT EXISTS memory_recall_log (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        recalled_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, turn_id, memory_id)
      );
      CREATE INDEX IF NOT EXISTS memory_recall_log_turn
        ON memory_recall_log(namespace, turn_id, recalled_at);
      /* 本轮实际注入的知识条目 / Skill / 规则文件。与 memory_recall_log 同样的理由另存：
         这些来源不改动任何既有行，运行结束后没有别的地方能回答「这一轮用了什么」。 */
      CREATE TABLE IF NOT EXISTS turn_context_sources (
        namespace TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        title TEXT NOT NULL,
        locator TEXT,
        detail TEXT,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY(namespace, turn_id, kind, ref_id)
      );
      CREATE INDEX IF NOT EXISTS turn_context_sources_turn
        ON turn_context_sources(namespace, turn_id, recorded_at);
      CREATE INDEX IF NOT EXISTS turn_context_sources_conversation
        ON turn_context_sources(namespace, conversation_id);
    `
