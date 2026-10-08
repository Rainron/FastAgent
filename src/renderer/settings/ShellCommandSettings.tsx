import { MAX_SHELL_COMMAND_TIMEOUT, MIN_SHELL_COMMAND_TIMEOUT, normalizeShellCommandSettings } from '../../shared/shell-command'
import type { AppSettings, ShellCommandOutputMode, ShellCommandSettings as CommandSettings } from '../../shared/types'

export function ShellCommandSettings({ settings, onChange }: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  const command = normalizeShellCommandSettings(settings.shellCommand)

  function patch(next: Partial<CommandSettings>) {
    onChange({ shellCommand: normalizeShellCommandSettings({ ...command, ...next }) })
  }

  return <section className="settings-panel" aria-labelledby="settings-shell-command">
    <div className="settings-section-heading"><div><h2 id="settings-shell-command">输入框命令</h2><p>在对话输入框输入 !ls、!git status 或 !cmd /c dir，按 Enter 执行。命令使用当前 Shell 偏好与沙箱设置。</p></div></div>
    <div className="settings-row">
      <div><strong>! 直接执行命令</strong><span>默认开启。开启时，!! 开头的内容按普通消息发送；关闭后，感叹号保留原样。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={command.enabled} onChange={(event) => patch({ enabled: event.target.checked })} aria-label="! 直接执行命令" />
        <span className="switch-visual" />
      </label>
    </div>
    <div className="settings-row">
      <div><strong>命令输出</strong><span>默认只在当前会话本地显示。加入上下文后，输出会保存到会话并在后续提问时提供给模型；回填输入框则由你编辑后发送。</span></div>
      <select value={command.output} disabled={!command.enabled} onChange={(event) => patch({ output: event.target.value as ShellCommandOutputMode })} aria-label="命令输出">
        <option value="local">只在本地显示</option>
        <option value="context">加入会话上下文</option>
        <option value="composer">回填输入框</option>
      </select>
    </div>
    <div className="settings-row">
      <div><strong>命令超时（秒）</strong><span>仅支持同步执行，默认 60 秒，最长 600 秒。可随时终止；切换会话会停止尚未完成的命令。</span></div>
      <input className="settings-number-input" type="number" min={MIN_SHELL_COMMAND_TIMEOUT} max={MAX_SHELL_COMMAND_TIMEOUT} step={1} value={command.timeoutSeconds} disabled={!command.enabled} onChange={(event) => patch({ timeoutSeconds: event.target.valueAsNumber })} aria-label="命令超时（秒）" />
    </div>
    <p className="settings-hint">Shell 类型与 Bash 路径可在“Agent 与权限”中调整。每条命令独立执行，cd 不会改变下一条命令的目录。</p>
  </section>
}
