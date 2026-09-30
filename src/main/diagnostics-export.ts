import type { AppRuntimeInfo, AppSettings, DoctorReport, RuntimeReport } from '../shared/types'

/**
 * 诊断信息导出。
 *
 * 唯一的硬约束是不泄露凭据：导出内容由本模块显式挑选字段拼出来，
 * 而不是把设置整份序列化再擦——白名单漏掉一个字段只是少一条信息，
 * 黑名单漏掉一个字段就是把密钥写进文件。
 */
export interface DiagnosticsInput {
  app: AppRuntimeInfo
  settings: AppSettings
  doctor: DoctorReport | null
  runtime: RuntimeReport | null
  counts: { conversations: number; projects: number; skills: number; mcpServers: number }
  generatedAt: number
}

/** 路径里带用户名，属于个人信息，只保留最后一段目录名。 */
function tailOf(path: string | null | undefined): string {
  if (!path) return ''
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return segments.length ? `…/${segments[segments.length - 1]}` : ''
}

export function buildDiagnosticsReport(input: DiagnosticsInput): Record<string, unknown> {
  return {
    generatedAt: new Date(input.generatedAt).toISOString(),
    app: {
      version: input.app.version,
      electron: input.app.electron,
      node: input.app.node,
      chrome: input.app.chrome,
      platform: input.app.platform,
      // 后端地址可能带租户信息，只标注配没配。
      backendConfigured: Boolean(input.app.backendUrl),
      dataRoot: tailOf(input.app.dataRoot)
    },
    settings: {
      shellPreference: input.settings.shellPreference,
      bashPathConfigured: Boolean(input.settings.bashPath),
      externalEditorConfigured: Boolean(input.settings.externalEditorPath),
      agentAbilityPolicy: input.settings.agentAbilityPolicy.mode,
      subAgentEnabled: input.settings.subAgentEnabled,
      memory: { enabled: input.settings.memory.enabled, autoExtract: input.settings.memory.autoExtract, maxRecall: input.settings.memory.maxRecall },
      contextStrategy: input.settings.contextStrategy,
      limits: input.settings.limits,
      sandboxEnabled: Boolean(input.settings.sandbox?.enabled)
    },
    counts: input.counts,
    doctor: input.doctor
      ? {
        checkedAt: new Date(input.doctor.checkedAt).toISOString(),
        overall: input.doctor.overall,
        summary: input.doctor.summary,
        checks: input.doctor.checks.map((check) => ({ id: check.id, label: check.label, status: check.status, detail: check.detail }))
      }
      : null,
    runtime: input.runtime
      ? {
        runtimeVersion: input.runtime.runtimeVersion,
        verified: input.runtime.verified,
        tools: input.runtime.tools.map((tool) => ({ id: tool.id, status: tool.status, source: tool.source, version: tool.version ?? null }))
      }
      : null
  }
}

export function renderDiagnosticsJson(input: DiagnosticsInput): string {
  return `${JSON.stringify(buildDiagnosticsReport(input), null, 2)}\n`
}
