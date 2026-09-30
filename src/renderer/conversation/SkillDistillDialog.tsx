import { useEffect, useRef, useState } from 'react'
import { Wand2 } from 'lucide-react'
import type { SkillDraft } from '../../shared/types'

/**
 * 蒸馏草稿确认弹窗：模型出的草稿允许人工改完再落库。
 * 保存走 skills.create（装完默认停用，与导入一致），名字冲突由用户改名重试。
 */
export function SkillDistillDialog({ draft, onClose, onSaved }: { draft: SkillDraft; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(draft.name)
  const [description, setDescription] = useState(draft.description)
  const [instructions, setInstructions] = useState(draft.instructions)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const nameValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64
  const canSave = nameValid && description.trim() !== '' && instructions.trim() !== '' && !saving

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await window.fastAgent.skills.create({ name, description, instructions })
      onSaved(name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
      setSaving(false)
    }
  }

  return <div className="approval-overlay" role="dialog" aria-modal="true" aria-label="提炼技能">
    <div className="approval-dialog skill-distill-dialog">
      <div className="approval-header">
        <span className="approval-icon"><Wand2 size={15} /></span>
        <div className="approval-heading"><strong>提炼为技能</strong></div>
      </div>
      <div className="approval-body skill-distill-body">
        <label className="skill-distill-field">
          <span>名称（小写字母、数字、连字符）</span>
          <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!nameValid} />
        </label>
        <label className="skill-distill-field">
          <span>描述（什么时候用）</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="skill-distill-field">
          <span>指令正文</span>
          <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={10} />
        </label>
        <p className="approval-note">保存后默认停用，可到「能力」里启用。</p>
        {error && <p className="approval-note skill-distill-error">{error}</p>}
      </div>
      <div className="approval-actions">
        <button className="quick-secondary" onClick={onClose}>取消</button>
        <button className="quick-secondary approval-primary" disabled={!canSave} onClick={() => void save()}>{saving ? '保存中…' : '保存技能'}</button>
      </div>
    </div>
  </div>
}
