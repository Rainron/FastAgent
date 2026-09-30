import type { LocalSkillRecord, SkillCheckResult, SkillDetail, SkillVersionRecord } from '../../../../shared/types'

export type SkillImportFormat = 'directory' | 'zip'
export type SkillConflictStrategy = 'overwrite' | 'save-as'

export const skillsService = {
  detail: (name: string): Promise<SkillDetail> => window.fastAgent.skills.detail(name),
  read: (name: string) => window.fastAgent.skills.get(name),
  create: (input: { name: string; description: string; instructions: string }) => window.fastAgent.skills.create(input),
  update: (name: string, patch: { description?: string; instructions?: string }) => window.fastAgent.skills.update(name, patch),
  remove: (name: string) => window.fastAgent.skills.remove(name),
  versions: (name: string): Promise<SkillVersionRecord[]> => window.fastAgent.skills.versions(name),
  revert: (name: string, revision: number) => window.fastAgent.skills.revert(name, revision),
  check: (name: string): Promise<SkillCheckResult> => window.fastAgent.skills.check(name),
  import: (options?: { format?: SkillImportFormat; onConflict?: SkillConflictStrategy }): Promise<LocalSkillRecord | null> =>
    window.fastAgent.skills.import(options)
}
