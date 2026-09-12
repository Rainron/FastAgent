import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { skillsService, type SkillConflictStrategy, type SkillImportFormat } from '../services/skills-service'

/**
 * 导入 Skill：格式与冲突策略在打开系统文件对话框之前选定，
 * 避免「选完文件才发现重名、只能重新走一遍选择器」。
 */
export function SkillImportDialog({ defaultFormat = 'directory', onClose, onImported }: {
  defaultFormat?: SkillImportFormat
  onClose: () => void
  onImported: (name: string) => void
}) {
  const [format, setFormat] = useState<SkillImportFormat>(defaultFormat)
  const [conflict, setConflict] = useState<SkillConflictStrategy | 'cancel'>('cancel')
  const actions = useAsyncActions()
  const importing = actions.isPending('import')

  async function submit() {
    const record = await actions.run('import', () => skillsService.import({
      format,
      onConflict: conflict === 'cancel' ? undefined : conflict
    }))
    if (record) onImported(record.name)
    else if (!actions.errorOf('import')) onClose()
  }

  return <CapabilityDrawer
    title="导入 Skill"
    subtitle="从本地目录或 ZIP 压缩包导入，导入后保持停用"
    onClose={onClose}
    footer={<>
      <button className="primary-button" onClick={() => void submit()} disabled={importing}>{importing && <LoaderCircle size={14} className="spin" />}{importing ? '导入中…' : '选择并导入'}</button>
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    <div className="cap-form">
      <div className="settings-inline-field">
        <span>来源格式</span>
        <div className="settings-shell-segmented" role="group" aria-label="导入格式">
          {([['directory', '本地目录 / SKILL.md'], ['zip', 'ZIP 压缩包']] as Array<[SkillImportFormat, string]>).map(([key, label]) =>
            <button key={key} type="button" className={format === key ? 'active' : ''} onClick={() => setFormat(key)}>{label}</button>)}
        </div>
      </div>
      <div className="settings-inline-field">
        <span>同名冲突时</span>
        <div className="settings-shell-segmented" role="group" aria-label="冲突处理">
          {([['cancel', '取消导入'], ['overwrite', '覆盖'], ['save-as', '另存为']] as Array<[SkillConflictStrategy | 'cancel', string]>).map(([key, label]) =>
            <button key={key} type="button" className={conflict === key ? 'active' : ''} onClick={() => setConflict(key)}>{label}</button>)}
        </div>
        <small className="cap-field-note">「覆盖」会删除同名 Skill 目录后重写；「另存为」自动追加序号并同步 SKILL.md 里的标识。</small>
      </div>
      {actions.errorOf('import') && <AbilityErrorBlock
        title="导入失败"
        message={actions.errorOf('import') as string}
        actions={<button className="small-control" onClick={() => setConflict('save-as')}>改为另存为</button>}
      />}
      <p className="settings-hint">含可执行脚本的 Skill 视为不可信输入，导入或启用前请确认来源。</p>
    </div>
  </CapabilityDrawer>
}
