import { useCallback, useEffect, useRef, useState } from 'react'
import { LogOut, RefreshCw, RotateCw } from 'lucide-react'
import type { AppSettings, GlobalShortcutAction, InAppShortcutAction, ShortcutBinding } from '../../shared/types'
import { bindingFromKeyboardEvent, bindingFromMouseEvent, bindingLabel, DEFAULT_IN_APP_BINDINGS, normalizeBinding } from '../shortcuts'

/**
 * 快捷键设置：全局（globalShortcut）与应用内（窗口层监听）两组动作的录制式绑定。
 * 点击「绑定」后直接按键盘组合键或鼠标中键/侧键完成录入；Esc 取消，Backspace 清除。
 */

const globalActions: Array<{ action: GlobalShortcutAction; label: string; description: string }> = [
  { action: 'showMainWindow', label: '显示主窗口', description: '从任意应用跳回 FastAgent 主窗口。' },
  { action: 'quickChat', label: '唤起快速对话', description: '弹出轻量对话窗，与连按两次 Ctrl 互相独立。' }
]

const inAppActions: Array<{ action: InAppShortcutAction; label: string; description: string }> = [
  { action: 'commandPalette', label: '打开模型选择器', description: '切换当前会话使用的模型。' },
  { action: 'newConversation', label: '新建会话', description: '开启一条新对话，并把光标落到输入框。' },
  { action: 'toggleTheme', label: '切换深浅主题', description: '在深色、浅色与跟随系统之间轮换。' },
  { action: 'openSettings', label: '打开设置', description: '跳到设置页。' },
  { action: 'hideToTray', label: '关闭主窗口到托盘', description: '隐藏主窗口只留系统托盘图标，等同点窗口的关闭按钮；后台任务继续运行。' },
  { action: 'reloadWindow', label: '重载界面', description: '只刷新窗口，登录状态与本地数据不受影响。' },
  { action: 'restartApp', label: '重启应用', description: '中断正在运行的任务并重启，触发后会再确认一次。' },
  { action: 'quitApp', label: '彻底退出应用', description: '绕开「关闭到托盘」直接退出，触发后会再确认一次。' }
]

// 这三个只在输入框聚焦时生效，单列一组，避免和窗口级动作混在一起看不出作用范围
const composerActions: Array<{ action: InAppShortcutAction; label: string; description: string }> = [
  { action: 'externalEditor', label: '外部编辑器起草', description: '把输入框草稿交给设置里指定的编辑器，保存后自动回填。' },
  { action: 'composerUndo', label: '输入框撤销', description: '撤销输入框内最近的修改。' },
  { action: 'composerRedo', label: '输入框重做', description: '恢复被撤销的输入框修改。' }
]

const ACTION_LABELS: Record<string, string> = Object.fromEntries([
  ...globalActions.map((item) => [item.action, item.label] as const),
  ...inAppActions.map((item) => [item.action, item.label] as const),
  ...composerActions.map((item) => [item.action, item.label] as const)
])

function effectiveBinding(shortcuts: AppSettings['shortcuts'], scope: 'global' | 'inApp', action: string): ShortcutBinding | null {
  const map = shortcuts?.[scope] as Record<string, ShortcutBinding | null | undefined> | undefined
  const stored = map?.[action]
  if (stored !== undefined) return stored ?? null
  if (scope === 'inApp') return DEFAULT_IN_APP_BINDINGS[action as InAppShortcutAction] ?? null
  return null
}

function BindingRow({ current, recording, conflict, onStart, onClear }: {
  current: ShortcutBinding | null
  recording: boolean
  conflict: string | null
  onStart: () => void
  onClear: () => void
}) {
  return <div className="settings-keybinding-binding">
    <code className={`settings-keybinding-keys${recording ? ' recording' : ''}${current ? '' : ' unset'}`}>{recording ? '按下组合键…' : bindingLabel(current)}</code>
    {conflict && <span className="settings-keybinding-conflict">{conflict}</span>}
    <button type="button" className="binding-button" onClick={onStart}>{recording ? '等待按键' : '绑定'}</button>
    {/* 录制态按 Backspace 也能清除，但那条路径不可见，这里给一个常驻入口 */}
    {current && !recording && <button type="button" className="binding-button" onClick={onClear} title="清除该绑定">清除</button>}
  </div>
}

function BindingRecorder({ shortcuts, scope, action, current, onChange }: {
  shortcuts: AppSettings['shortcuts']
  scope: 'global' | 'inApp'
  action: GlobalShortcutAction | InAppShortcutAction
  current: ShortcutBinding | null
  onChange: (value: ShortcutBinding | null) => void
}) {
  const [recording, setRecording] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)
  // 录制期间用 ref 存最新绑定表，避免监听器闭包拿到过期数据
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  const commit = useCallback((binding: ShortcutBinding) => {
    const normalized = normalizeBinding(binding)
    const scopes: Array<'global' | 'inApp'> = ['global', 'inApp']
    for (const scopeKey of scopes) {
      const map = shortcutsRef.current?.[scopeKey] as Record<string, ShortcutBinding | null | undefined> | undefined
      for (const [otherAction, otherBinding] of Object.entries(map ?? {})) {
        if (otherAction === action && scopeKey === scope) continue
        if (otherBinding && normalizeBinding(otherBinding).type === normalized.type && normalizeBinding(otherBinding).value === normalized.value) {
          setConflict(`与「${ACTION_LABELS[otherAction] ?? otherAction}」的绑定冲突，未保存`)
          setRecording(false)
          return
        }
      }
    }
    // 未自定义过的默认绑定不在设置表里，单独比对；已被用户覆盖的默认值不再算冲突
    for (const [defaultAction, defaultBinding] of Object.entries(DEFAULT_IN_APP_BINDINGS) as Array<[InAppShortcutAction, ShortcutBinding]>) {
      if (scope === 'inApp' && defaultAction === action) continue
      if (shortcutsRef.current?.inApp?.[defaultAction] !== undefined) continue
      const other = normalizeBinding(defaultBinding)
      if (other.type === normalized.type && other.value === normalized.value) {
        setConflict(`与「${ACTION_LABELS[defaultAction] ?? defaultAction}」的默认绑定冲突，未保存`)
        setRecording(false)
        return
      }
    }
    setConflict(null)
    setRecording(false)
    onChange(normalized)
  }, [action, onChange, scope])

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') { setRecording(false); setConflict(null); return }
      // 裸 Backspace 表示清除绑定；带修饰键时按普通组合键处理
      if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        setRecording(false); setConflict(null); onChange(null); return
      }
      const binding = bindingFromKeyboardEvent(event)
      if (binding) commit(binding)
    }
    const onMouseDown = (event: MouseEvent) => {
      const binding = bindingFromMouseEvent(event)
      if (binding) { event.preventDefault(); event.stopPropagation(); commit(binding) }
    }
    // 用捕获阶段抢先拿到按键，避免触发其他已注册快捷键
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [commit, onChange, recording])

  return <BindingRow
    current={current}
    recording={recording}
    conflict={conflict}
    onStart={() => { setConflict(null); setRecording(true) }}
    onClear={() => { setConflict(null); setRecording(false); onChange(null) }}
  />
}

export function KeybindingSettings({ settings, onChange, onNotice }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void; onNotice: (notice: string) => void }) {
  const updateBinding = (scope: 'global' | 'inApp', action: string, value: ShortcutBinding | null) => {
    const currentGlobal = settings.shortcuts?.global ?? {}
    const currentInApp = settings.shortcuts?.inApp ?? {}
    const nextGlobal = scope === 'global' ? { ...currentGlobal, [action]: value } : currentGlobal
    const nextInApp = scope === 'inApp' ? { ...currentInApp, [action]: value } : currentInApp
    onChange({ shortcuts: { global: nextGlobal, inApp: nextInApp } })
  }

  return <section className="settings-panel" aria-labelledby="settings-keybinding">
    <div className="settings-section-heading"><div><h2 id="settings-keybinding">全局快捷键</h2><p>在应用外也能触发的系统级快捷键；点击「绑定」后直接按组合键或鼠标侧键完成录入。</p></div></div>
    <div className="settings-row">
      <div><strong>连按两次 Ctrl 唤起快速对话</strong><span>任意界面连按两次 Ctrl（间隔 0.5 秒内）弹出轻量对话窗，失焦自动隐藏。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={settings.quickDialogEnabled} onChange={(event) => onChange({ quickDialogEnabled: event.target.checked })} aria-label="连按两次 Ctrl 唤起快速对话" />
        <span className="switch-visual" />
      </label>
    </div>
    {globalActions.map((item) => <div className="settings-row" key={item.action}>
      <div><strong>{item.label}</strong><span>{item.description}</span></div>
      <BindingRecorder
        shortcuts={settings.shortcuts}
        scope="global"
        action={item.action}
        current={effectiveBinding(settings.shortcuts, 'global', item.action)}
        onChange={(value) => updateBinding('global', item.action, value)}
      />
    </div>)}

    <div className="settings-section-heading"><div><h2>应用内快捷键</h2><p>仅在 FastAgent 窗口内生效；鼠标绑定支持中键与前后侧键。</p></div></div>
    {inAppActions.map((item) => <div className="settings-row" key={item.action}>
      <div><strong>{item.label}</strong><span>{item.description}</span></div>
      <BindingRecorder
        shortcuts={settings.shortcuts}
        scope="inApp"
        action={item.action}
        current={effectiveBinding(settings.shortcuts, 'inApp', item.action)}
        onChange={(value) => updateBinding('inApp', item.action, value)}
      />
    </div>)}

    <div className="settings-section-heading"><div><h2>输入框快捷键</h2><p>只在消息输入框聚焦时生效，不会影响其他输入框的原生撤销。</p></div></div>
    {composerActions.map((item) => <div className="settings-row" key={item.action}>
      <div><strong>{item.label}</strong><span>{item.description}</span></div>
      <BindingRecorder
        shortcuts={settings.shortcuts}
        scope="inApp"
        action={item.action}
        current={effectiveBinding(settings.shortcuts, 'inApp', item.action)}
        onChange={(value) => updateBinding('inApp', item.action, value)}
      />
    </div>)}

    <div className="settings-section-heading"><div><h2>应用控制</h2><p>重启会中断正在运行的任务，动作前会再确认一次。</p></div></div>
    <div className="settings-row settings-row-column">
      <div className="settings-app-control">
        <button className="quick-secondary" onClick={() => { void window.fastAgent.app.restart().then((done) => { if (!done) onNotice('已取消重启') }) }}><RotateCw size={14} />重启应用</button>
        <button className="quick-secondary" onClick={() => { void window.fastAgent.app.reload() }}><RefreshCw size={14} />重载界面</button>
        <button className="quick-secondary danger" onClick={() => { void window.fastAgent.app.quit().then((done) => { if (!done) onNotice('已取消退出') }) }}><LogOut size={14} />彻底退出应用</button>
      </div>
      <p className="connection-hint">重载界面只刷新窗口，登录状态与本地数据不受影响。</p>
    </div>
  </section>
}
