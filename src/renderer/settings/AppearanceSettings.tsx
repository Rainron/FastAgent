import type { AppTheme } from '../../shared/types'

const themes: Array<{ value: AppTheme; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' }
]

export function AppearanceSettings({ theme, onThemeChange }: { theme: AppTheme; onThemeChange: (theme: AppTheme) => void }) {
  return <section className="settings-panel" aria-labelledby="settings-appearance">
    <div className="settings-section-heading"><div><h2 id="settings-appearance">主题</h2><p>主题会同步应用到窗口标题栏，并在重启后保持。</p></div></div>
    <div className="settings-row">
      <div><strong>外观</strong><span>选择浅色、深色或跟随 Windows 系统设置。</span></div>
      <div className="reasoning-segmented settings-segmented" role="group" aria-label="主题">
        {themes.map((item) => <button key={item.value} className={theme === item.value ? 'active' : ''} onClick={() => onThemeChange(item.value)} aria-pressed={theme === item.value}>{item.label}</button>)}
      </div>
    </div>
  </section>
}
