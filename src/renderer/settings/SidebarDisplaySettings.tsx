import type { AppSettings } from '../../shared/types'
import { normalizeSidebarDisplay, SIDEBAR_DISPLAY_LIMIT } from '../../shared/sidebar-display'

const fields = [
  { key: 'workspaces', label: '工作区显示数量', hint: '侧栏收起时显示的工作区数量。', min: 1, max: 100 },
  { key: 'projectConversations', label: '每个工作区对话数量', hint: '每个展开工作区下默认显示的会话数量。', min: 1, max: 100 },
  { key: 'recentConversations', label: '最近对话显示数量', hint: '跨工作区最近对话列表默认显示的数量。', min: 1, max: 100 }
] as const

export function SidebarDisplaySettings({ value, onChange }: { value: AppSettings['sidebarDisplay']; onChange: (value: NonNullable<AppSettings['sidebarDisplay']>) => void }) {
  const display = normalizeSidebarDisplay(value)
  return <>
    <div className="settings-section-heading"><div><h2>侧栏</h2><p>分别设置工作区、项目会话和最近对话的预览数量。</p></div></div>
    {fields.map(({ key, label, hint, min, max }) => <label className="settings-row" key={key}>
      <div><strong>{label}</strong><span>{hint}</span></div>
      <input type="number" min={min} max={max} step={1} value={display[key]} aria-label={label}
        onChange={(event) => {
          const raw = event.currentTarget.value
          if (raw === '') return
          const next = Math.min(SIDEBAR_DISPLAY_LIMIT.max, Math.max(SIDEBAR_DISPLAY_LIMIT.min, Math.floor(Number(raw))))
          onChange({ ...display, [key]: next })
        }} />
    </label>)}
  </>
}
