import { describe, expect, it } from 'vitest'
import type { AppRuntimeInfo, AppSettings } from '../shared/types'
import { defaultSettings } from './local-store/row-mappers'
import { buildDiagnosticsReport, renderDiagnosticsJson, type DiagnosticsInput } from './diagnostics-export'

const app: AppRuntimeInfo = {
  version: '1.2.3',
  electron: '33',
  node: '20',
  chrome: '130',
  platform: 'win32',
  dataRoot: 'C:/Users/somebody/.fa',
  backendUrl: 'https://tenant.internal.example.com/api'
}

function input(patch: Partial<DiagnosticsInput> = {}): DiagnosticsInput {
  return {
    app,
    settings: { ...defaultSettings, bashPath: 'C:/Program Files/Git/bin/bash.exe', externalEditorPath: '' } as AppSettings,
    doctor: null,
    runtime: null,
    counts: { conversations: 3, projects: 1, skills: 2, mcpServers: 0 },
    generatedAt: 1_700_000_000_000,
    ...patch
  }
}

describe('buildDiagnosticsReport', () => {
  it('后端地址只报「配没配」，不写出地址本身', () => {
    const report = buildDiagnosticsReport(input()) as { app: { backendConfigured: boolean } }
    expect(report.app.backendConfigured).toBe(true)
    expect(JSON.stringify(report)).not.toContain('tenant.internal.example.com')
  })

  it('数据根只留最后一段，用户名不出现在导出里', () => {
    const json = renderDiagnosticsJson(input())
    expect(json).not.toContain('somebody')
    expect(json).toContain('…/.fa')
  })

  it('本机路径类设置只报是否配置过', () => {
    const json = renderDiagnosticsJson(input())
    expect(json).not.toContain('Program Files')
    expect(json).toContain('"bashPathConfigured": true')
    expect(json).toContain('"externalEditorConfigured": false')
  })

  it('运行上限原样带出，供排查「为什么被拦下来」', () => {
    const report = buildDiagnosticsReport(input()) as { settings: { limits: unknown } }
    expect(report.settings.limits).toEqual(defaultSettings.limits)
  })

  it('没有体检与运行时报告时如实给 null，不编造结果', () => {
    const report = buildDiagnosticsReport(input()) as { doctor: unknown; runtime: unknown }
    expect(report.doctor).toBeNull()
    expect(report.runtime).toBeNull()
  })

  it('体检结果只带结论字段，hint 之外的原始细节不额外扩散', () => {
    const report = buildDiagnosticsReport(input({
      doctor: {
        checkedAt: 1,
        overall: 'warn',
        summary: { ok: 1, warn: 1, error: 0, missing: 0 },
        checks: [{ id: 'shell', label: 'Shell', category: 'shell', status: 'warn', detail: '未找到 bash', version: null, hint: '安装 Git Bash' }]
      }
    })) as { doctor: { checks: Array<Record<string, unknown>> } }
    expect(Object.keys(report.doctor.checks[0])).toEqual(['id', 'label', 'status', 'detail'])
  })
})
