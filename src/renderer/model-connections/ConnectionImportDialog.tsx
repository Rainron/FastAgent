import { useMemo, useState } from 'react'
import { Download, FileJson, LoaderCircle } from 'lucide-react'
import type { ModelConnectionsArchive, ModelConnectionsArchivePreview, ModelProviderPreset } from '../../shared/types'
import { CenterDialog } from '../components/CenterDialog'
import { archiveErrorMessage } from './archive-error'
import { ArchiveEntryList } from './ArchiveEntryList'
import type { ArchiveEntry, ArchiveSelection } from './archive-selection'
import { selectAll, selectedCount } from './archive-selection'

/** 模型服务导入：选文件 → 预览（必要时输口令）→ 按厂商与模型两级勾选 → 落地为新连接。 */
export function ConnectionImportDialog({ providers, onClose, onNotice, onImported }: {
  providers: ModelProviderPreset[]
  onClose: () => void
  onNotice: (notice: string) => void
  onImported: () => Promise<void> | void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [contents, setContents] = useState<ModelConnectionsArchive | null>(null)
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [selection, setSelection] = useState<ArchiveSelection>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // key 用归档里的下标：同一份归档里连接名可能重复，下标才是导入计划认的标识。
  const entries = useMemo<ArchiveEntry[]>(() => (contents?.connections ?? []).map((entry, index) => ({
    key: String(index),
    name: entry.name,
    meta: `${providers.find((provider) => provider.id === entry.providerId)?.name ?? entry.providerId} · ${entry.models.length} 个模型`,
    note: entry.hasSecrets ? undefined : entry.authMode === 'oauth' ? '账号连接，导入后需重新登录' : '不含密钥，导入后需补填 API Key',
    models: entry.models.map((model) => ({ id: model.modelId, label: model.name ?? model.modelId }))
  })), [contents, providers])

  function applyPreview(preview: ModelConnectionsArchivePreview) {
    setPath(preview.path)
    setNeedsPassphrase(preview.needsPassphrase)
    setContents(preview.contents)
    if (preview.contents) {
      setSelection(selectAll(preview.contents.connections.map((entry, index) => ({
        key: String(index), name: entry.name, meta: '', models: entry.models.map((model) => ({ id: model.modelId, label: model.modelId }))
      }))))
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { setError(archiveErrorMessage(cause, '操作失败，请重试')) }
    finally { setBusy(false) }
  }

  const count = selectedCount(selection)
  return <CenterDialog
    title="导入模型服务"
    subtitle={path ?? '选择一个 FastAgent 模型服务归档（.json）'}
    icon={<Download size={16} />}
    busy={busy}
    onClose={onClose}
    footer={<>
      <button type="button" className="approval-secondary" onClick={onClose} disabled={busy}>取消</button>
      {contents
        ? <button type="button" className="approval-primary" disabled={busy || count.entries === 0} onClick={() => void run(async () => {
            const imported = await window.fastAgent.modelConnections.importConnections(path!, {
              indexes: Object.keys(selection).map(Number).sort((a, b) => a - b),
              modelIds: selection,
              passphrase: passphrase || undefined
            })
            onNotice(`已导入 ${imported} 个模型服务、${count.models} 个模型`)
            await onImported()
            onClose()
          })}>{busy && <LoaderCircle size={14} className="spin" />}导入所选（{count.entries}）</button>
        : <button type="button" className="approval-primary" disabled={busy} onClick={() => void run(async () => {
            const preview = await window.fastAgent.modelConnections.previewArchive()
            if (preview) applyPreview(preview)
          })}>{busy && <LoaderCircle size={14} className="spin" />}选择文件</button>}
    </>}
  >
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!path && <div className="ability-empty"><FileJson size={20} /><strong>还没有选择文件</strong><span>选择归档后可以按厂商与模型逐条勾选要导入的内容。</span></div>}

    {needsPassphrase && <div className="ability-detail-section">
      <div className="cap-section-heading"><span>这个归档带了加密的密钥</span></div>
      <label className="settings-inline-field"><span>口令</span>
        <input type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="导出时设置的口令" />
      </label>
      <div className="model-connection-actions">
        <button type="button" className="quick-secondary" disabled={busy || !passphrase.trim()} onClick={() => void run(async () => {
          applyPreview(await window.fastAgent.modelConnections.previewArchivePath(path!, passphrase))
        })}>解锁并预览</button>
      </div>
    </div>}

    {contents && <div className="ability-detail-section">
      <div className="cap-section-heading">
        <span>归档内容 · 已选 {count.entries} / {entries.length} 个厂商</span>
        <small>导出于 {new Date(contents.exportedAt).toLocaleString()}{contents.appVersion ? ` · v${contents.appVersion}` : ''}</small>
      </div>
      <div className="cap-section-heading">
        <span>{count.models} 个模型</span>
        <div className="model-connection-actions">
          <button type="button" className="small-control" onClick={() => setSelection(selectAll(entries))}>全选</button>
          <button type="button" className="small-control" disabled={count.entries === 0} onClick={() => setSelection({})}>清空</button>
        </div>
      </div>
      <ArchiveEntryList entries={entries} selection={selection} onChange={setSelection} />
    </div>}

    {contents && <p className="settings-hint">导入一律新建连接：与本地同名时自动另存为副本，不会覆盖已有的密钥与模型。</p>}
  </CenterDialog>
}
