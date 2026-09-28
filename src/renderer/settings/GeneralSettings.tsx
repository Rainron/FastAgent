import { useEffect, useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import type { AppSettings, ClientPreferences } from '../../shared/types'
import { DEFAULT_PAGE_SIZE, normalizePageSize, PAGE_SIZE_OPTIONS } from '../../shared/pagination'
import { notifyPaginationPageSizeChanged } from '../use-pagination'

const rows: Array<{ key: 'startAtLogin' | 'showOnStartup' | 'closeToTray'; label: string; description: string }> = [
  { key: 'startAtLogin', label: '开机启动 FastAgent', description: '登录 Windows 后自动运行 FastAgent。' },
  { key: 'showOnStartup', label: '启动后显示主窗口', description: '关闭后 FastAgent 会静默启动到系统托盘。' },
  { key: 'closeToTray', label: '关闭窗口时最小化到系统托盘', description: '关闭后点击窗口 × 将直接退出应用。' }
]

export function GeneralSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const [editorPathDraft, setEditorPathDraft] = useState(settings.externalEditorPath)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  useEffect(() => { setEditorPathDraft(settings.externalEditorPath) }, [settings.externalEditorPath])
  useEffect(() => { void window.fastAgent.preferences.get().then((preferences) => setPageSize(normalizePageSize(preferences.paginationPageSize))).catch(() => undefined) }, [])

  function updatePageSize(value: number) {
    setPageSize(value)
    void window.fastAgent.preferences.update({ paginationPageSize: value } satisfies Partial<ClientPreferences>)
    notifyPaginationPageSizeChanged(value)
  }

  function commitEditorPath() {
    const trimmed = editorPathDraft.trim()
    if (trimmed !== settings.externalEditorPath) onChange({ externalEditorPath: trimmed })
  }

  function pickEditorExecutable() {
    void window.fastAgent.settings.pickEditorExecutable().then((picked) => {
      if (picked) {
        setEditorPathDraft(picked)
        onChange({ externalEditorPath: picked })
      }
    })
  }

  return <section className="settings-panel" aria-labelledby="settings-general">
    <div className="settings-section-heading"><div><h2 id="settings-general">启动与后台</h2><p>控制 FastAgent 的启动方式与关闭窗口后的行为。</p></div></div>
    {rows.map((row) => <div className="settings-row" key={row.key}>
      <div><strong>{row.label}</strong><span>{row.description}</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={settings[row.key]} onChange={(event) => onChange({ [row.key]: event.target.checked })} aria-label={row.label} />
        <span className="switch-visual" />
      </label>
    </div>)}

    <div className="settings-section-heading"><div><h2>界面动画</h2><p>控制页面切换、按钮反馈和状态动效；关闭后保留清晰的状态变化。</p></div></div>
    <div className="settings-row">
      <div><strong>界面动画</strong><span>跟随系统会响应系统的减少动态效果设置。</span></div>
      <select value={settings.motionPreference} onChange={(event) => onChange({ motionPreference: event.target.value as AppSettings['motionPreference'] })} aria-label="界面动画">
        <option value="system">跟随系统</option><option value="on">开启</option><option value="off">关闭</option>
      </select>
    </div>

    <div className="settings-section-heading"><div><h2>列表分页</h2><p>控制会话、项目、插件和能力列表每次加载的数量。</p></div></div>
    <div className="settings-row">
      <div><strong>每页数量</strong><span>数值越小首屏加载越快，也可以直接在列表底部的分页条上改。</span></div>
      <select value={pageSize} onChange={(event) => updatePageSize(Number(event.target.value))} aria-label="列表每页数量">
        {PAGE_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value} 条</option>)}
      </select>
    </div>

    <div className="settings-section-heading"><div><h2>附件上传</h2><p>限制文件与图片大小，并控制允许上传的类型。</p></div></div>
    <div className="settings-row">
      <div><strong>普通文件大小（MB）</strong><span>超过限制时会提示暂不支持。</span></div>
      <input className="settings-number-input" type="number" min={1} max={500} value={settings.attachmentMaxFileSizeMb} onChange={(event) => onChange({ attachmentMaxFileSizeMb: Number(event.target.value) || 1 })} />
    </div>
    <div className="settings-row">
      <div><strong>图片大小（MB）</strong><span>图片默认限制为 5MB。</span></div>
      <input className="settings-number-input" type="number" min={1} max={100} value={settings.attachmentMaxImageSizeMb} onChange={(event) => onChange({ attachmentMaxImageSizeMb: Number(event.target.value) || 1 })} />
    </div>
    <div className="settings-row settings-row-column"><div><strong>允许的文件类型</strong><span>使用扩展名并以逗号分隔，例如 pdf,txt,md。</span></div><input value={settings.attachmentFileExtensions.join(',')} onChange={(event) => onChange({ attachmentFileExtensions: event.target.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) })} /></div>
    <div className="settings-row settings-row-column"><div><strong>允许的图片类型</strong><span>使用扩展名并以逗号分隔，例如 png,jpg,webp。</span></div><input value={settings.attachmentImageExtensions.join(',')} onChange={(event) => onChange({ attachmentImageExtensions: event.target.value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean) })} /></div>

    <div className="settings-section-heading"><div><h2>外部编辑器</h2><p>在输入框按 Ctrl+G 会把草稿交给这里指定的编辑器；保存并回到 FastAgent 后内容自动回填输入框。</p></div></div>
    <div className="settings-row settings-row-column">
      <div className="settings-bash-path">
        <input
          value={editorPathDraft}
          onChange={(event) => setEditorPathDraft(event.target.value)}
          onBlur={commitEditorPath}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          placeholder="编辑器可执行文件路径（留空用系统默认应用）"
          aria-label="外部编辑器可执行文件路径"
          spellCheck={false}
        />
        <button type="button" className="settings-bash-pick" onClick={pickEditorExecutable} title="选择编辑器程序"><FolderOpen size={13} />浏览</button>
        {settings.externalEditorPath && <button type="button" className="icon-button" onClick={() => { setEditorPathDraft(''); onChange({ externalEditorPath: '' }) }} aria-label="清除外部编辑器路径" title="清除，恢复系统默认应用"><X size={13} /></button>}
      </div>
      <p className="connection-hint">常见路径如 VS Code 的 Code.exe、Notepad++ 的 notepad++.exe。路径失效时会退回系统默认应用。</p>
    </div>
  </section>
}
