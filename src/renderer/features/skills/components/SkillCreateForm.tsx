import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { skillsService } from '../services/skills-service'

export type SkillFormMode = { mode: 'create' } | { mode: 'edit'; name: string }

/** 新建 / 编辑 Skill：新建后固定为停用状态，安装与启用分离。 */
export function SkillCreateForm({ form, skillsDir, onClose, onSaved }: {
  form: SkillFormMode
  skillsDir?: string
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const editing = form.mode === 'edit' ? form.name : null
  const [name, setName] = useState(editing ?? '')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [loaded, setLoaded] = useState(!editing)
  const [loadError, setLoadError] = useState<string | null>(null)
  const actions = useAsyncActions()

  useEffect(() => {
    if (!editing) return
    void skillsService.read(editing).then((skill) => {
      setDescription(skill.description)
      setInstructions(skill.instructions)
      setLoaded(true)
    }).catch((error) => setLoadError(error instanceof Error ? error.message : 'Skill 内容加载失败'))
  }, [editing])

  const canSave = Boolean(name.trim() && description.trim() && instructions.trim())
  const saving = actions.isPending('save')

  async function submit() {
    if (!canSave || saving) return
    const saved = await actions.run('save', async () => {
      if (editing) {
        await skillsService.update(editing, { description: description.trim(), instructions: instructions.trim() })
        return editing
      }
      const created = await skillsService.create({ name: name.trim(), description: description.trim(), instructions: instructions.trim() })
      return created.name
    })
    if (saved) onSaved(saved)
  }

  return <CapabilityDrawer
    title={editing ? `编辑 Skill：${editing}` : '新建 Skill'}
    subtitle={editing ? '修改描述与指令，标识不可变更' : '生成标准的 skills/<name>/SKILL.md'}
    onClose={onClose}
    footer={<>
      <button className="primary-button" onClick={() => void submit()} disabled={!canSave || saving}>{saving && <LoaderCircle size={14} className="spin" />}{saving ? '保存中…' : editing ? '保存修改' : '创建 Skill'}</button>
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    {loadError ? <AbilityErrorBlock title="内容加载失败" message={loadError} /> : !loaded ? <div className="ability-loading">加载中…</div> : <div className="cap-form">
      <label className="settings-inline-field"><span>标识 *</span><input value={name} disabled={Boolean(editing)} onChange={(event) => setName(event.target.value)} placeholder="my-skill" /><small className="cap-field-note">小写字母、数字与单个连字符；同时作为目录名。</small></label>
      <label className="settings-inline-field"><span>描述 *</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="做什么、何时用（单行）" /></label>
      <label className="settings-inline-field"><span>指令 *</span><textarea rows={12} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="模型按此执行的具体说明" /></label>
      <label className="settings-inline-field"><span>存储目录</span><input value={skillsDir ? `${skillsDir}\\${name || '<name>'}` : '~/.fa/skills'} readOnly /><small className="cap-field-note">受管目录固定，创建后可在列表中「打开目录」。</small></label>
      {actions.errorOf('save') && <AbilityErrorBlock title="保存失败" message={actions.errorOf('save') as string} />}
      <p className="settings-hint">{editing ? '编辑会重写 SKILL.md 的指令部分。' : '创建后默认停用，需要显式启用后 Agent 才可见。'}</p>
    </div>}
  </CapabilityDrawer>
}
