import { Boxes, Check, Monitor, Moon, Sun } from 'lucide-react'
import type { AppSettings, AppTheme } from '../../shared/types'
import { clampSidebarTitleChars, SIDEBAR_TITLE_CHARS } from '../../shared/sidebar-title'

const themes: Array<{ value: AppTheme; label: string; hint: string; Icon: typeof Sun }> = [
  { value: 'light', label: '浅色', hint: '日光下的暖白', Icon: Sun },
  { value: 'dark', label: '深色', hint: '低照度的夜间', Icon: Moon },
  { value: 'system', label: '跟随系统', hint: '随 Windows 自动切换', Icon: Monitor }
]

const accents: Array<{ value: NonNullable<AppSettings['accentColor']>; label: string; swatch: string }> = [
  { value: 'green', label: '森绿', swatch: '#2f9e77' },
  { value: 'terracotta', label: '陶土', swatch: '#c96f4a' },
  { value: 'blue', label: '湖蓝', swatch: '#3e8ec4' },
  { value: 'purple', label: '藤紫', swatch: '#8467ba' },
  { value: 'graphite', label: '石墨', swatch: '#6f7480' }
]

const fontSizes: Array<{ value: NonNullable<AppSettings['baseFontSize']>; label: string }> = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' }
]

const densities: Array<{ value: NonNullable<AppSettings['uiDensity']>; label: string }> = [
  { value: 'comfortable', label: '宽松' },
  { value: 'compact', label: '紧凑' }
]

const surfaceLevels: Array<{ value: NonNullable<AppSettings['surfaceLevel']>; label: string }> = [
  { value: 'dim', label: '沉稳' },
  { value: 'standard', label: '标准' },
  { value: 'bright', label: '明亮' }
]

const bodyContrasts: Array<{ value: NonNullable<AppSettings['bodyTextContrast']>; label: string }> = [
  { value: 'soft', label: '柔和' },
  { value: 'standard', label: '标准' },
  { value: 'strong', label: '强烈' }
]

export function AppearanceSettings({ settings, theme, onThemeChange, onChange }: { settings: AppSettings; theme: AppTheme; onThemeChange: (theme: AppTheme) => void; onChange: (patch: Partial<AppSettings>) => void }) {
  const titleChars = clampSidebarTitleChars(settings.sidebarTitleChars)
  return <section className="settings-panel appearance" aria-labelledby="settings-appearance">
    <div className="settings-section-heading"><div><h2 id="settings-appearance">主题</h2><p>主题会同步应用到窗口标题栏，并在重启后保持。</p></div></div>
    <div className="theme-cards">
      {themes.map(({ value, label, hint, Icon }) => <button key={value} className={`theme-card${theme === value ? ' on' : ''}`} onClick={() => onThemeChange(value)} aria-pressed={theme === value}>
        <span className={`theme-chip ${value}`} aria-hidden="true"><Icon size={14} /></span>
        <span className="theme-card-copy"><strong>{label}</strong><small>{hint}</small></span>
        {theme === value && <span className="theme-check" aria-hidden="true"><Check size={12} /></span>}
      </button>)}
    </div>
    <div className="settings-section-heading"><div><h2>强调色</h2><p>作用于按钮、链接与高亮；深浅两套主题各自调校。</p></div></div>
    <div className="settings-row">
      <div><strong>色板</strong><span>选一颗主色点亮界面。</span></div>
      <div className="swatches" role="radiogroup" aria-label="强调色">
        {accents.map((item) => <button key={item.value} className={`swatch${settings.accentColor === item.value ? ' on' : ''}`} style={{ '--swatch': item.swatch } as React.CSSProperties} onClick={() => onChange({ accentColor: item.value })} role="radio" aria-checked={settings.accentColor === item.value} aria-label={item.label} title={item.label}>{settings.accentColor === item.value && <Check size={11} />}</button>)}
      </div>
    </div>
    <div className="settings-row">
      <div><strong>侧栏毛玻璃</strong><span>窗口失焦或移动时透出桌面；性能优先可关闭。</span></div>
      <label className="switch-row"><input type="checkbox" checked={Boolean(settings.sidebarGlass)} onChange={(event) => onChange({ sidebarGlass: event.target.checked })} /><span className="switch-visual" aria-hidden="true" /></label>
    </div>
    <div className="settings-row">
      <div><strong>侧栏标题长度</strong><span>会话标题最多显示多少个字；放不下的部分在鼠标悬停时自右向左滚出来。</span></div>
      <div className="settings-slider">
        <input
          type="range"
          min={SIDEBAR_TITLE_CHARS.min}
          max={SIDEBAR_TITLE_CHARS.max}
          step={1}
          value={titleChars}
          aria-label="侧栏会话标题最多显示字数"
          onChange={(event) => onChange({ sidebarTitleChars: clampSidebarTitleChars(Number(event.target.value)) })}
        />
        <output>{titleChars} 字</output>
      </div>
    </div>
    <div className="settings-section-heading"><div><h2>底色与正文</h2><p>浅色与深色各有一套取值，切主题后按当前主题生效。</p></div></div>
    <div className="settings-row">
      <div><strong>底色明度</strong><span>整条底色阶梯一起平移：画布、侧栏、卡片与分隔线。深色下「明亮」即不那么黑。</span></div>
      <div className="reasoning-segmented settings-segmented" role="group" aria-label="底色明度">
        {surfaceLevels.map((item) => <button key={item.value} className={settings.surfaceLevel === item.value ? 'active' : ''} onClick={() => onChange({ surfaceLevel: item.value })} aria-pressed={settings.surfaceLevel === item.value}>{item.label}</button>)}
      </div>
    </div>
    <div className="settings-row">
      <div><strong>正文对比</strong><span>只作用于对话区正文，侧栏与设置页文字不变。深色下越强越亮，浅色下越强越暗。</span></div>
      <div className="reasoning-segmented settings-segmented" role="group" aria-label="对话正文对比">
        {bodyContrasts.map((item) => <button key={item.value} className={settings.bodyTextContrast === item.value ? 'active' : ''} onClick={() => onChange({ bodyTextContrast: item.value })} aria-pressed={settings.bodyTextContrast === item.value}>{item.label}</button>)}
      </div>
    </div>
    <div className="settings-section-heading"><div><h2>排版</h2><p>字号与密度立即生效。</p></div></div>
    <div className="settings-row">
      <div><strong>界面字号</strong><span>整体缩放，含侧栏与设置页。</span></div>
      <div className="reasoning-segmented settings-segmented" role="group" aria-label="界面字号">
        {fontSizes.map((item) => <button key={item.value} className={settings.baseFontSize === item.value ? 'active' : ''} onClick={() => onChange({ baseFontSize: item.value })} aria-pressed={settings.baseFontSize === item.value}>{item.label}</button>)}
      </div>
    </div>
    <div className="settings-row">
      <div><strong>界面密度</strong><span>紧凑档收紧列表与卡片留白。</span></div>
      <div className="reasoning-segmented settings-segmented" role="group" aria-label="界面密度">
        {densities.map((item) => <button key={item.value} className={settings.uiDensity === item.value ? 'active' : ''} onClick={() => onChange({ uiDensity: item.value })} aria-pressed={settings.uiDensity === item.value}>{item.label}</button>)}
      </div>
    </div>
    <div className="settings-section-heading"><div><h2>预览</h2><p>当前组合下的消息与按钮观感。</p></div></div>
    <div className="appearance-preview" aria-hidden="true">
      <span className="avatar"><Boxes size={12} /></span>
      <span className="bubble">界面预览：换个心情，换个颜色。</span>
      <button className="primary-button">主要操作</button>
      <button className="quick-secondary">次要操作</button>
    </div>
  </section>
}
