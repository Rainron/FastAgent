import { useState } from 'react'
import { FileArchive, LoaderCircle } from 'lucide-react'
import type { BundleContents } from '../../../../shared/types'
import { CapabilityDrawer } from './CapabilityDrawer'
import { AbilityErrorBlock } from './AbilityErrorBlock'
import { useAsyncActions } from '../hooks/useAsyncAction'
import { bundleService } from '../services/bundle-service'

type Conflict = 'save-as' | 'overwrite'

/** 整包导入：选包 → 预览 → 逐条勾选 →（冲突策略）→ 落地。 */
export function BundleImportDialog({ onClose, onNotice, onImported }: {
  onClose: () => void
  onNotice: (notice: string) => void
  onImported: () => void
}) {
  const [path, setPath] = useState<string | null>(null)
  const [contents, setContents] = useState<BundleContents | null>(null)
  const [needsPassphrase, setNeedsPassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [conflict, setConflict] = useState<Conflict>('save-as')
  const actions = useAsyncActions()

  function applyPreview(preview: { path: string; needsPassphrase: boolean; contents: BundleContents | null }) {
    setPath(preview.path)
    setNeedsPassphrase(preview.needsPassphrase)
    setContents(preview.contents)
    if (preview.contents) {
      setSelected(new Set([
        ...preview.contents.skills.map((skill) => `skill::${skill.name}`),
        ...preview.contents.mcpServers.map((entry) => `mcp::${entry.server.id}`),
        ...preview.contents.cliTools.map((entry) => `cli::${entry.tool.id}`)
      ]))
    }
  }

  async function pick() {
    const preview = await actions.run('pick', () => bundleService.preview())
    if (!preview) return
    applyPreview(preview)
  }

  async function unlock() {
    if (!path) return
    const preview = await actions.run('unlock', () => bundleService.previewPath(path, passphrase))
    if (preview) applyPreview(preview)
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function run() {
    if (!path || !contents) return
    const installed = await actions.run('import', () => bundleService.import(path, {
      skillNames: contents.skills.map((skill) => skill.name).filter((name) => selected.has(`skill::${name}`)),
      mcpIds: contents.mcpServers.map((entry) => entry.server.id).filter((id) => selected.has(`mcp::${id}`)),
      cliIds: contents.cliTools.map((entry) => entry.tool.id).filter((id) => selected.has(`cli::${id}`)),
      onConflict: conflict,
      passphrase: passphrase || undefined
    }))
    if (!installed) return
    onNotice(`已导入 ${installed.length} 项能力（默认停用）`)
    onImported()
    onClose()
  }

  return <CapabilityDrawer
    title="导入能力整包"
    subtitle={path ?? '选择一个 .fabundle 或 Skill 压缩包'}
    onClose={onClose}
    footer={<>
      {contents
        ? <button className="primary-button" onClick={() => void run()} disabled={actions.isPending('import') || selected.size === 0}>
            {actions.isPending('import') && <LoaderCircle size={14} className="spin" />}导入所选（{selected.size}）
          </button>
        : <button className="primary-button" onClick={() => void pick()} disabled={actions.isPending('pick')}>
            {actions.isPending('pick') && <LoaderCircle size={14} className="spin" />}选择文件
          </button>}
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    <div className="ability-detail-body">
      {!path && <div className="ability-empty"><FileArchive size={20} /><strong>还没有选择文件</strong><span>选择一个能力整包后可以逐条勾选要导入的内容。</span></div>}

      {needsPassphrase && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>这个整包带了加密的密钥</span></div>
        <label className="settings-inline-field"><span>口令</span>
          <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="导出时设置的口令" />
        </label>
        <div className="ability-empty-actions">
          <button className="quick-secondary" onClick={() => void unlock()} disabled={!passphrase.trim() || actions.isPending('unlock')}>解锁并预览</button>
        </div>
        {actions.errorOf('unlock') && <AbilityErrorBlock title="解锁失败" message={actions.errorOf('unlock') as string} />}
      </div>}

      {contents && <>
        <div className="ability-detail-section">
          <div className="cap-section-heading">
            <span>整包内容</span>
            <small>导出于 {new Date(contents.exportedAt).toLocaleString()}{contents.appVersion ? ` · v${contents.appVersion}` : ''}</small>
          </div>
          <ul className="bundle-entry-list">
            {contents.skills.map((skill) => <li key={`skill-${skill.name}`}>
              <label><input type="checkbox" checked={selected.has(`skill::${skill.name}`)} onChange={() => toggle(`skill::${skill.name}`)} />
                <strong>{skill.name}</strong><span>Skill</span></label>
            </li>)}
            {contents.mcpServers.map((entry) => <li key={`mcp-${entry.server.id}`}>
              <label><input type="checkbox" checked={selected.has(`mcp::${entry.server.id}`)} onChange={() => toggle(`mcp::${entry.server.id}`)} />
                <strong>{entry.server.name}</strong><span>MCP Server</span>
                {!entry.server.env && !entry.server.headers && <small>不含密钥，导入后需要补配置</small>}</label>
            </li>)}
            {contents.cliTools.map((entry) => <li key={`cli-${entry.tool.id}`}>
              <label><input type="checkbox" checked={selected.has(`cli::${entry.tool.id}`)} onChange={() => toggle(`cli::${entry.tool.id}`)} />
                <strong>{entry.tool.name}</strong><span>CLI 工具</span></label>
            </li>)}
          </ul>
        </div>

        <div className="ability-detail-section">
          <div className="cap-section-heading"><span>同名冲突</span></div>
          <label className="bundle-secret-option">
            <input type="radio" name="bundle-conflict" checked={conflict === 'save-as'} onChange={() => setConflict('save-as')} />
            <span><strong>另存为副本</strong><small>本地已有同名 Skill 时改名保存，不动原来的。</small></span>
          </label>
          <label className="bundle-secret-option">
            <input type="radio" name="bundle-conflict" checked={conflict === 'overwrite'} onChange={() => setConflict('overwrite')} />
            <span><strong>覆盖</strong><small>用整包里的版本替换本地同名 Skill。</small></span>
          </label>
        </div>
      </>}

      {actions.errorOf('pick') && <AbilityErrorBlock title="读取整包失败" message={actions.errorOf('pick') as string} />}
      {actions.errorOf('import') && <AbilityErrorBlock title="导入失败" message={actions.errorOf('import') as string} />}
      {contents && <p className="settings-hint">导入的能力一律以停用状态落地，需要显式启用后 Agent 才可见。</p>}
    </div>
  </CapabilityDrawer>
}
