import type { BundleExportOptions, BundleImportPlan, BundlePreview, HubInstalledAbility } from '../../../../shared/types'

/** 能力整包导入导出的 IPC 薄封装。 */
export const bundleService = {
  export: (options: BundleExportOptions): Promise<string | null> => window.fastAgent.bundle.export(options),
  exportSkill: (name: string): Promise<string | null> => window.fastAgent.bundle.exportSkill(name),
  preview: (passphrase?: string): Promise<BundlePreview | null> => window.fastAgent.bundle.preview(passphrase),
  previewPath: (path: string, passphrase?: string): Promise<BundlePreview> => window.fastAgent.bundle.previewPath(path, passphrase),
  import: (path: string, plan: BundleImportPlan): Promise<HubInstalledAbility[]> => window.fastAgent.bundle.import(path, plan)
}
