import type { LocalSkillRecord, SkillDetail } from '../../../../shared/types'

export type SkillImportFormat = 'directory' | 'zip'
export type SkillConflictStrategy = 'overwrite' | 'save-as'

export const skillsService = {
  detail: (name: string): Promise<SkillDetail> => window.fastAgent.skills.detail(name),
  read: (name: string) => window.fastAgent.skills.get(name),
  create: (input: { name: string; description: string; instructions: string }) => window.fastAgent.skills.create(input),
  update: (name: string, patch: { description?: string; instructions?: string }) => window.fastAgent.skills.update(name, patch),
  remove: (name: string) => window.fastAgent.skills.remove(name),
  import: (options?: { format?: SkillImportFormat; onConflict?: SkillConflictStrategy }): Promise<LocalSkillRecord | null> =>
    window.fastAgent.skills.import(options)
}
