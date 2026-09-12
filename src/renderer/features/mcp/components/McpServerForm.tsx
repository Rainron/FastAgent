import { useState } from 'react'
import { LoaderCircle, Plug } from 'lucide-react'
import type { LocalMcpServerInput, McpAbility, McpTestStatus } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { mcpService } from '../services/mcp-service'

function parseJsonObject(text: string): Record<string, string> | undefined {
  try {
    const parsed = text ? JSON.parse(text) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : undefined
  } catch {
    return undefined
  }
}

/** 手动添加 / 编辑 MCP Server：stdio 与 Streamable HTTP 两套字段。 */
export function McpServerForm({ ability, onClose, onSaved }: {
  ability?: McpAbility
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const [name, setName] = useState(ability?.name ?? '')
  const [transport, setTransport] = useState<LocalMcpServerInput['transport']>(ability?.transport ?? 'stdio')
  const [command, setCommand] = useState(ability?.command ?? '')
  const [args, setArgs] = useState(ability?.args?.join(' ') ?? '')
  const [cwd, setCwd] = useState(ability?.cwd ?? '')
  const [url, setUrl] = useState(ability?.url ?? '')
  const [envText, setEnvText] = useState('')
  const [headersText, setHeadersText] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(ability?.timeoutMs ?? 30_000)
  const [testResult, setTestResult] = useState<McpTestStatus | null>(null)
  const actions = useAsyncActions()

  const secretText = transport === 'stdio' ? envText : headersText
  const secretInvalid = Boolean(secretText.trim()) && parseJsonObject(secretText.trim()) === undefined
  const canSave = Boolean(name.trim()) && Boolean(transport === 'stdio' ? command.trim() : url.trim()) && !secretInvalid

  function draft(enabled: boolean): LocalMcpServerInput {
    return {
      id: ability?.id || name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
      name: name.trim(),
      transport,
      command: transport === 'stdio' ? command.trim() : undefined,
      args: transport === 'stdio' ? args.split(/\s+/).filter(Boolean) : undefined,
      cwd: transport === 'stdio' && cwd.trim() ? cwd.trim() : undefined,
      url: transport === 'streamable_http' ? url.trim() : undefined,
      // 密钥字段留空时不提交，避免把已保存的加密密钥清空。
      env: transport === 'stdio' && envText.trim() ? parseJsonObject(envText.trim()) : undefined,
      headers: transport === 'streamable_http' && headersText.trim() ? parseJsonObject(headersText.trim()) : undefined,
      enabled,
      timeoutMs
    }
  }

  async function test() {
    if (!canSave) return
    const status = await actions.run('test', () => mcpService.testConfig(draft(false)))
    if (status) setTestResult(status)
  }

  async function save(enabled: boolean) {
    if (!canSave) return
    const saved = await actions.run('save', () => mcpService.save(draft(enabled)))
    if (saved) onSaved(saved.name)
  }

  const testing = actions.isPending('test')
  const saving = actions.isPending('save')

  return <CapabilityDrawer
    title={ability ? `编辑 Server：${ability.name}` : '添加 MCP Server'}
    subtitle="配置外部工具服务，密钥经系统加密保存在本机"
    onClose={onClose}
    footer={<>
      <button className="quick-secondary" onClick={() => void test()} disabled={!canSave || testing}>{testing ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}{testing ? '测试中…' : '测试连接'}</button>
      <button className="quick-secondary" onClick={onClose}>取消</button>
      <button className="quick-secondary" onClick={() => void save(false)} disabled={!canSave || saving}>{saving && <LoaderCircle size={14} className="spin" />}保存</button>
      <button className="primary-button" onClick={() => void save(true)} disabled={!canSave || saving}>保存并启用</button>
    </>}
  >
    <div className="cap-form">
      <label className="settings-inline-field"><span>名称 *</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Docs Server" /></label>
      <label className="settings-inline-field"><span>传输方式</span>
        <select value={transport} onChange={(event) => setTransport(event.target.value as LocalMcpServerInput['transport'])}>
          <option value="stdio">stdio（本地命令）</option>
          <option value="streamable_http">Streamable HTTP（远程）</option>
        </select>
      </label>
      {transport === 'stdio' ? <>
        <label className="settings-inline-field"><span>命令 *</span><input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" /></label>
        <label className="settings-inline-field"><span>参数</span><input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem" /></label>
        <label className="settings-inline-field"><span>工作目录</span><input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="留空使用默认" /></label>
        <label className="settings-inline-field"><span>环境变量（JSON）</span><input value={envText} placeholder='{"API_KEY":"…"}' onChange={(event) => setEnvText(event.target.value)} />{ability?.hasSecrets && <small className="cap-field-note">已有加密密钥，留空保持不变。</small>}</label>
      </> : <>
        <label className="settings-inline-field"><span>URL *</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.example/mcp" /></label>
        <label className="settings-inline-field"><span>请求头（JSON）</span><input value={headersText} placeholder='{"Authorization":"Bearer …"}' onChange={(event) => setHeadersText(event.target.value)} />{ability?.hasSecrets && <small className="cap-field-note">已有加密密钥，留空保持不变。</small>}</label>
      </>}
      <label className="settings-inline-field"><span>调用超时（ms）</span><input type="number" min={500} step={500} value={timeoutMs} onChange={(event) => setTimeoutMs(Math.max(500, Number(event.target.value) || 30_000))} /></label>

      {secretInvalid && <AbilityErrorBlock title="格式错误" message="密钥字段必须是 JSON 对象，例如 {&quot;API_KEY&quot;:&quot;…&quot;}。" />}
      {actions.errorOf('test') && <AbilityErrorBlock title="测试失败" message={actions.errorOf('test') as string} />}
      {actions.errorOf('save') && <AbilityErrorBlock title="保存失败" message={actions.errorOf('save') as string} />}
      {testResult && (testResult.ok
        ? <div className="ability-test-ok">连接成功 · 发现 {testResult.toolCount} 个工具</div>
        : <AbilityErrorBlock title="连接失败" message={testResult.error ?? '未知错误'} />)}

      <p className="settings-hint">「保存」后 Server 处于停用状态，Agent 不会连接；确认可用后再启用。密钥使用系统加密保存，界面不会回显具体值。</p>
    </div>
  </CapabilityDrawer>
}
