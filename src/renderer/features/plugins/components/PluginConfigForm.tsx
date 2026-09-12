import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { PluginConfigField } from '../../../../shared/types'

/** 按 configFields 渲染；secret 字段默认遮挡，值只在提交时随 IPC 上行。 */
export function PluginConfigForm({ fields, values, onChange }: {
  fields: PluginConfigField[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  return <div className="cap-form">
    {fields.map((field) => {
      const masked = field.secret && !revealed[field.key]
      return <label className="settings-inline-field" key={field.key}>
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <div className="plugin-secret-input">
          <input
            type={masked ? 'password' : 'text'}
            value={values[field.key] ?? ''}
            placeholder={field.placeholder}
            onChange={(event) => onChange(field.key, event.target.value)}
          />
          {field.secret && <button type="button" className="icon-button" aria-label={masked ? '显示' : '遮挡'} onClick={() => setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))}>
            {masked ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>}
        </div>
        {field.description && <small className="cap-field-note">{field.description}</small>}
      </label>
    })}
  </div>
}
