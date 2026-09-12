import { useEffect, useState } from 'react'
import { LoaderCircle, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { AppSettings, SandboxCapabilities } from '../../shared/types'
import { networkModeLabel, sandboxStatusLabel, SANDBOX_NETWORK_MODES, type SandboxNetworkMode } from '../../shared/sandbox'

const DISABLE_WARNING = [
  '关闭沙箱后，Agent 执行的命令将直接访问你的系统和文件。',
  'Agent 可能读取、修改或删除工作区之外的文件，也可能访问本机凭据和网络资源。',
  '仅在你完全信任当前任务时关闭沙箱。'
]

/** restricted 需要域名代理，第一阶段不提供，界面上置灰而不是假装生效。 */
const NETWORK_DESCRIPTIONS: Record<SandboxNetworkMode, string> = {
  off: 'Agent 子进程完全禁止访问网络。',
  restricted: '仅允许访问下方域名，需要域名代理，下一版本提供。',
  full: 'Agent 子进程可正常联网，但仍运行在沙箱账户与受限令牌下。'
}

export function SandboxSettings({ settings, onChange }: { settings: AppSettings; onChange: (patch: Partial<AppSettings>) => void }) {
  const sandbox = settings.sandbox
  const [capabilities, setCapabilities] = useState<SandboxCapabilities | null>(null)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.fastAgent.sandbox.status().then(setCapabilities).catch(() => setCapabilities(null))
  }, [])

  function patchSandbox(patch: Partial<AppSettings['sandbox']>) {
    onChange({ sandbox: { ...sandbox, ...patch } })
  }

  function toggleEnabled(next: boolean) {
    if (!next) { setConfirmDisable(true); return }
    setConfirmDisable(false)
    patchSandbox({ enabled: true })
  }

  async function initialize() {
    setInitializing(true)
    setError(null)
    try {
      setCapabilities(await window.fastAgent.sandbox.initialize())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '初始化失败')
    } finally {
      setInitializing(false)
    }
  }

  const ready = capabilities?.status === 'ready'

  return <section className="settings-panel" aria-labelledby="settings-sandbox">
    <div className="settings-section-heading"><div><h2 id="settings-sandbox">安全与沙箱</h2><p>沙箱在权限规则之上再加一层系统级边界：即使 Agent 想越权，操作系统也会拒绝。</p></div></div>

    <div className="settings-row">
      <div><strong>Agent 沙箱</strong><span>开启后，Agent 执行的终端命令、脚本和外部程序将在受限制的系统环境中运行，以降低误操作或恶意代码影响本机系统的风险。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={sandbox.enabled} onChange={(event) => toggleEnabled(event.target.checked)} aria-label="Agent 沙箱" />
        <span className="switch-visual" />
      </label>
    </div>

    {confirmDisable && <div className="settings-row settings-row-column sandbox-warning">
      <div className="sandbox-warning-head"><TriangleAlert size={16} /><strong>确认关闭 Agent 沙箱？</strong></div>
      {DISABLE_WARNING.map((line) => <p key={line} className="settings-hint">{line}</p>)}
      <div className="ability-empty-actions">
        <button className="quick-secondary danger" onClick={() => { patchSandbox({ enabled: false }); setConfirmDisable(false) }}>仍要关闭</button>
        <button className="quick-secondary" onClick={() => setConfirmDisable(false)}>取消</button>
      </div>
    </div>}

    <div className="settings-section-heading" style={{ marginTop: 18 }}><div><h2>文件系统</h2><p>工作区之外的写入与敏感目录读取由 Windows 账户与 ACL 强制拒绝，不依赖应用层路径校验。</p></div></div>
    <div className="permission-preset-rules">
      <div className="permission-rule-row"><span className="permission-rule-key">工作区读写</span><span className="permission-rule-patterns"><code><em className="action-allow">允许</em></code></span></div>
      <div className="permission-rule-row"><span className="permission-rule-key">工作区外写入</span><span className="permission-rule-patterns"><code><em className="action-deny">禁止</em></code></span></div>
      <div className="permission-rule-row"><span className="permission-rule-key">敏感目录读取</span><span className="permission-rule-patterns"><code><em className="action-deny">禁止</em></code></span></div>
    </div>

    <div className="settings-section-heading" style={{ marginTop: 18 }}><div><h2>网络</h2><p>网络权限独立于文件权限；禁止网络时 curl、git clone、npm install 等一律不通。</p></div></div>
    <div className="settings-segmented" role="group" aria-label="Agent 网络访问">
      {SANDBOX_NETWORK_MODES.map((mode) => (
        <button
          key={mode}
          className={sandbox.networkMode === mode ? 'active' : ''}
          disabled={mode === 'restricted'}
          title={NETWORK_DESCRIPTIONS[mode]}
          onClick={() => patchSandbox({ networkMode: mode })}
          aria-pressed={sandbox.networkMode === mode}
        >{networkModeLabel(mode)}</button>
      ))}
    </div>
    <p className="settings-hint">{NETWORK_DESCRIPTIONS[sandbox.networkMode]}</p>
    <div className="permission-user-rules">
      {sandbox.allowedDomains.map((domain) => <div className="permission-user-rule" key={domain}><code className="permission-user-pattern">{domain}</code><span className="permission-user-action">受限模式启用后生效</span></div>)}
    </div>

    <div className="settings-section-heading" style={{ marginTop: 18 }}><div><h2>高级</h2><p>沙箱不可用时默认停止任务，不会静默降级为完全访问。</p></div></div>
    <div className="settings-row">
      <div><strong>沙箱失败时允许直接执行</strong><span>打开后，沙箱启动失败时 Agent 命令会以当前 Windows 用户身份运行，并在对话中给出降级提示。</span></div>
      <label className="switch-row">
        <input type="checkbox" checked={sandbox.allowUnsandboxedFallback} onChange={(event) => patchSandbox({ allowUnsandboxedFallback: event.target.checked })} aria-label="沙箱失败时允许直接执行" />
        <span className="switch-visual" />
      </label>
    </div>

    <div className="settings-section-heading" style={{ marginTop: 18 }}><div><h2>沙箱状态</h2><p>初始化需要一次管理员授权，之后运行 Agent 不再弹出 UAC。</p></div></div>
    <div className="settings-row">
      <div>
        <strong>{ready ? <><ShieldCheck size={14} /> 正常</> : <><ShieldAlert size={14} /> {capabilities ? sandboxStatusLabel(capabilities.status) : '检测中…'}</>}</strong>
        <span>{capabilities?.setupVersion ? `沙箱组件版本 ${capabilities.setupVersion}` : '尚未检测到已安装的沙箱组件。'}</span>
      </div>
      <button className="quick-secondary" onClick={() => void initialize()} disabled={initializing || ready}>
        {initializing && <LoaderCircle size={13} className="spin" />}{initializing ? '初始化中…' : '初始化 Agent 沙箱'}
      </button>
    </div>
    {error && <p className="settings-hint">初始化失败：{error}</p>}
    <p className="settings-hint">当前版本中，MCP Server 仍在应用进程内启动，不受 Agent 沙箱约束；文件读写类工具由权限规则与安全守卫控制。</p>
  </section>
}
