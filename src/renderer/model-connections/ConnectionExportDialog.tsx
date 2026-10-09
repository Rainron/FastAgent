import { useMemo, useState } from 'react'
import { LoaderCircle, Upload } from 'lucide-react'
import type { BundleSecretMode, ModelConnectionSummary, ModelProviderPreset } from '../../shared/types'
import { CenterDialog } from '../components/CenterDialog'
import { archiveErrorMessage } from './archive-error'
import { ArchiveEntryList } from './ArchiveEntryList'
import type { ArchiveEntry, ArchiveSelection } from './archive-selection'
import { selectAll, selectedCount } from './archive-selection'

const SECRET_OPTIONS: Array<[BundleSecretMode, string, string]> = [
  ['omit', '不带密钥', '产物里不出现任何密钥值。换机器后需要重新填写 API Key。'],
  ['encrypted', '口令加密', '密钥用口令加密后随文件带走，导入时需要同一口令。'],
  ['plain', '明文带出', '密钥以明文写入文件。只在你能完全控制这个文件时使用。']
]

/** 模型服务导出：按厂商、再按连接内模型两级勾选，并决定密钥怎么处理。 */
export function ConnectionExportDialog({ connections, providers, onClose, onNotice }: {
  connections: ModelConnectionSummary[]
  providers: ModelProviderPreset[]
  onClose: () => void
  onNotice: (notice: string) => void
}) {
  const entries = useMemo<ArchiveEntry[]>(() => connections.map((connection) => ({
    key: connection.id,
    name: connection.name,
    meta: `${providers.find((provider) => provider.id === connection.providerId)?.name ?? connection.providerId} · ${connection.models.length} 个模型`,
    note: connection.authMode === 'oauth' ? '账号连接不带凭据，导入后需重新登录' : undefined,
    models: connection.models.map((model) => ({ id: model.model_name, label: model.name ?? model.model_name }))
  })), [connections, providers])

  const [selection, setSelection] = useState<ArchiveSelection>(() => selectAll(entries))
  const [secrets, setSecrets] = useState<BundleSecretMode>('omit')
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const count = selectedCount(selection)
  const mismatch = secrets === 'encrypted' && confirm.length > 0 && confirm !== passphrase
  const blocked = secrets === 'encrypted' && (!passphrase.trim() || confirm !== passphrase)
  const carriesKeys = secrets !== 'omit' && connections.some((connection) => selection[connection.id] && connection.authMode === 'api-key' && connection.hasCredentials)

  async function run() {
    setBusy(true)
    setError('')
    try {
      const path = await window.fastAgent.modelConnections.exportConnections({
        ids: Object.keys(selection),
        modelIds: selection,
        secrets,
        passphrase: secrets === 'encrypted' ? passphrase : undefined
      })
      if (!path) return
      onNotice(`已导出 ${count.entries} 个模型服务、${count.models} 个模型到 ${path}`)
      onClose()
    } catch (cause) { setError(archiveErrorMessage(cause, '导出失败，请重试')) }
    finally { setBusy(false) }
  }

  return <CenterDialog
    title="导出模型服务"
    subtitle={`已选择 ${count.entries} / ${entries.length} 个厂商 · ${count.models} 个模型`}
    icon={<Upload size={16} />}
    busy={busy}
    onClose={onClose}
    footer={<>
      <button type="button" className="approval-secondary" onClick={onClose} disabled={busy}>取消</button>
      <button type="button" className="approval-primary" onClick={() => void run()} disabled={busy || count.entries === 0 || blocked}>
        {busy && <LoaderCircle size={14} className="spin" />}导出
      </button>
    </>}
  >
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="ability-detail-section">
      <div className="cap-section-heading">
        <span>包含的模型服务</span>
        <div className="model-connection-actions">
          <button type="button" className="small-control" disabled={count.entries === entries.length && count.models === entries.reduce((total, entry) => total + entry.models.length, 0)} onClick={() => setSelection(selectAll(entries))}>全选</button>
          <button type="button" className="small-control" disabled={count.entries === 0} onClick={() => setSelection({})}>清空</button>
        </div>
      </div>
      <ArchiveEntryList entries={entries} selection={selection} onChange={setSelection} />
    </div>

    <div className="ability-detail-section">
      <div className="cap-section-heading"><span>密钥处理</span></div>
      {SECRET_OPTIONS.map(([mode, label, hint]) => <label key={mode} className="bundle-secret-option">
        <input type="radio" name="model-archive-secrets" checked={secrets === mode} onChange={() => setSecrets(mode)} />
        <span><strong>{label}</strong><small>{hint}</small></span>
      </label>)}
      {secrets === 'encrypted' && <>
        <label className="settings-inline-field"><span>口令</span>
          <input type="password" autoComplete="new-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="导入时需要这个口令" />
        </label>
        <label className="settings-inline-field"><span>确认口令</span>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="再输入一次" />
        </label>
        {mismatch && <p className="auth-error" role="alert">两次输入的口令不一致</p>}
      </>}
      {secrets === 'plain' && <p className="plugin-unknown-source">明文导出的文件等同于密钥本身，不要提交到仓库或通过聊天工具传递。</p>}
      {secrets !== 'omit' && !carriesKeys && <p className="settings-hint">所选连接里没有可带走的 API Key，产物只会包含厂商与模型配置。</p>}
    </div>

    <p className="settings-hint">账号（OAuth）连接一律不带凭据，导入后需要重新登录厂商账号。</p>
  </CenterDialog>
}
