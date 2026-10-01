import { renderDiagnosticsJson } from '../diagnostics-export'
import { buildDoctorReport, probeTools } from '../doctor'
import { buildRuntimeReport } from '../runtime/runtime-report'
import { dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import type { IpcRegistrar, MainContext } from '../app-context'

/** 运行时自检、环境体检与诊断导出。 */
export function registerDiagnosticsIpc(handle: IpcRegistrar, ctx: MainContext) {
  handle('runtime:status', (_event, verify?: boolean) => buildRuntimeReport({ installDir: ctx.runtimeInstallDir(), verify: Boolean(verify) }))
  handle('runtime:repair', () => {
    ctx.applyBundledRuntime(true)
    return buildRuntimeReport({ installDir: ctx.runtimeInstallDir(), verify: true })
  })
  handle('doctor:run', async () => {
    const checks = await probeTools(undefined, ctx.bundledTools)
    checks.push(...await ctx.environmentChecks())
    return buildDoctorReport(checks)
  })
  /**
   * 导出诊断信息。内容由 diagnostics-export 显式挑字段拼出来，
   * 后端地址、本机路径与凭据都不落进文件——白名单漏字段只是少一条信息，
   * 黑名单漏字段就是把密钥写进去。
   */
  handle('doctor:export', async () => {
    const checks = await probeTools(undefined, ctx.bundledTools)
    checks.push(...await ctx.environmentChecks())
    const doctor = buildDoctorReport(checks)
    const namespace = ctx.requireNamespace()
    const payload = renderDiagnosticsJson({
      app: ctx.appRuntimeInfo(),
      settings: ctx.settings,
      doctor,
      runtime: buildRuntimeReport({ installDir: ctx.runtimeInstallDir(), verify: false }),
      counts: {
        conversations: ctx.store.conversationStats(namespace, true).total,
        projects: ctx.store.listProjects(namespace).length,
        skills: ctx.skillRegistry.list().length,
        mcpServers: ctx.store.listMcpServers().length
      },
      generatedAt: Date.now()
    })
    const result = await dialog.showSaveDialog({
      title: '导出诊断信息',
      defaultPath: `fastagent-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, payload, 'utf8')
    return result.filePath
  })
}
