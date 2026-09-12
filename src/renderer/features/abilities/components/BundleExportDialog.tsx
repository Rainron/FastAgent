import { useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { Ability, BundleSecretMode } from '../../../../shared/types'
import { CapabilityDrawer } from './CapabilityDrawer'
import { AbilityErrorBlock } from './AbilityErrorBlock'
import { useAsyncActions } from '../hooks/useAsyncAction'
import { TYPE_LABELS } from '../ability-view'
import { bundleService } from '../services/bundle-service'

const SECRET_OPTIONS: Array<[BundleSecretMode, string, string]> = [
  ['omit', '不带密钥', '产物里不出现任何密钥值。换机器后需要重新填写。'],
  ['encrypted', '口令加密', '密钥用口令加密后随包带走，导入时需要同一口令。'],
  ['plain', '明文带出', '密钥以明文写入文件。只在你能完全控制这个文件时使用。']
]

/** 整包导出：逐条勾选要带走的能力，并决定密钥怎么处理。 */
export function BundleExportDialog({ abilities, onClose, onNotice }: {
  abilities: Ability[]
  onClose: () => void
  onNotice: (notice: string) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(abilities.map((ability) => `${ability.type}::${ability.id}`)))
  const [secrets, setSecrets] = useState<BundleSecretMode>('omit')
  const [passphrase, setPassphrase] = useState('')
  const actions = useAsyncActions()

  const hasSecretBearing = useMemo(() => abilities.some((ability) => ability.type === 'mcp'), [abilities])
  const blocked = secrets === 'encrypted' && !passphrase.trim()

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function idsOf(type: Ability['type']) {
    return abilities.filter((ability) => ability.type === type && selected.has(`${type}::${ability.id}`)).map((ability) => ability.id)
  }

  async function run() {
    const path = await actions.run('export', () => bundleService.export({
      skillNames: idsOf('skill'),
      mcpIds: idsOf('mcp'),
      cliIds: idsOf('cli'),
      secrets,
      passphrase: secrets === 'encrypted' ? passphrase : undefined
    }))
    if (path === undefined) return
    if (path === null) return
    onNotice(`已导出到 ${path}`)
    onClose()
  }

  return <CapabilityDrawer
    title="导出能力整包"
    subtitle={`已选择 ${selected.size} / ${abilities.length} 项`}
    onClose={onClose}
    footer={<>
      <button className="primary-button" onClick={() => void run()} disabled={actions.isPending('export') || selected.size === 0 || blocked}>
        {actions.isPending('export') && <LoaderCircle size={14} className="spin" />}导出
      </button>
      <button className="quick-secondary" onClick={onClose}>取消</button>
    </>}
  >
    <div className="ability-detail-body">
      <div className="ability-detail-section">
        <div className="cap-section-heading">
          <span>包含的能力</span>
          <button className="small-control" onClick={() => setSelected(selected.size === abilities.length ? new Set() : new Set(abilities.map((ability) => `${ability.type}::${ability.id}`)))}>
            {selected.size === abilities.length ? '全不选' : '全选'}
          </button>
        </div>
        <ul className="bundle-entry-list">
          {abilities.map((ability) => {
            const key = `${ability.type}::${ability.id}`
            return <li key={key}>
              <label>
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
                <strong>{ability.displayName}</strong>
                <span>{TYPE_LABELS[ability.type]}</span>
                {ability.enabled && <small>已启用</small>}
              </label>
            </li>
          })}
        </ul>
      </div>

      {hasSecretBearing && <div className="ability-detail-section">
        <div className="cap-section-heading"><span>密钥处理</span></div>
        {SECRET_OPTIONS.map(([mode, label, hint]) => <label key={mode} className="bundle-secret-option">
          <input type="radio" name="bundle-secrets" checked={secrets === mode} onChange={() => setSecrets(mode)} />
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>)}
        {secrets === 'encrypted' && <label className="settings-inline-field"><span>口令</span>
          <input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="导入时需要这个口令" />
        </label>}
        {secrets === 'plain' && <p className="plugin-unknown-source">明文导出的文件等同于密钥本身，不要提交到仓库或通过聊天工具传递。</p>}
      </div>}

      {actions.errorOf('export') && <AbilityErrorBlock title="导出失败" message={actions.errorOf('export') as string} />}
      <p className="settings-hint">整包记录能力的启用状态，但导入端一律以停用状态落地。</p>
    </div>
  </CapabilityDrawer>
}
