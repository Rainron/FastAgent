import { useEffect, useState } from 'react'
import type { SkillAbility, SkillDetail } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityEmptyState, AbilityLoadingState } from '../../abilities/components/AbilityEmptyState'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { abilityStatusPresentation, SOURCE_LABELS } from '../../abilities/ability-view'
import { skillsService } from '../services/skills-service'

type DetailTab = 'overview' | 'content' | 'files' | 'permissions' | 'usage'

const TABS: Array<[DetailTab, string]> = [
  ['overview', '概览'],
  ['content', '内容'],
  ['files', '文件'],
  ['permissions', '权限'],
  ['usage', '使用记录']
]

function formatSize(size: number) {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`
}

export function SkillDetailPanel({ ability, onClose, onOpenLocation }: {
  ability: SkillAbility
  onClose: () => void
  onOpenLocation: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setError(null)
    void skillsService.detail(ability.name)
      .then(setDetail)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Skill 详情加载失败'))
  }, [ability.name])

  const hasScripts = detail?.files.some((file) => /\.(js|mjs|cjs|ts|py|sh|ps1|bat|cmd|exe)$/i.test(file.path)) ?? false

  return <CapabilityDrawer
    title={ability.displayName}
    subtitle={`${ability.name} · ${SOURCE_LABELS[ability.source]}${ability.version ? ` · v${ability.version}` : ''}`}
    onClose={onClose}
    footer={<button className="quick-secondary" onClick={onOpenLocation}>打开目录</button>}
  >
    <nav className="ability-detail-tabs" role="tablist" aria-label="Skill 详情">
      {TABS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
      ))}
    </nav>
    {error ? <AbilityErrorBlock title="详情加载失败" message={error} /> : !detail ? <AbilityLoadingState /> : <div className="ability-detail-body">
      {tab === 'overview' && <dl className="ability-meta-list">
        <div><dt>状态</dt><dd><AbilityStatusBadge status={abilityStatusPresentation(ability.status)} /></dd></div>
        <div><dt>描述</dt><dd>{detail.description}</dd></div>
        <div><dt>来源</dt><dd>{SOURCE_LABELS[detail.source]}{detail.pluginId ? ` · ${detail.pluginId}` : ''}</dd></div>
        <div><dt>版本</dt><dd>{detail.version ?? '未标注'}</dd></div>
        <div><dt>作者</dt><dd>{detail.author ?? '未标注'}</dd></div>
        <div><dt>安装时间</dt><dd>{detail.installedAt ? new Date(detail.installedAt).toLocaleString() : '未知'}</dd></div>
        <div><dt>本地路径</dt><dd className="mono">{detail.filePath}</dd></div>
      </dl>}
      {tab === 'content' && <pre className="ability-code-block">{detail.instructions}</pre>}
      {tab === 'files' && (detail.files.length ? <div className="ability-file-list">
        {detail.files.map((file) => <div className="ability-file-row" key={file.path}><span className="mono">{file.path}</span><small>{formatSize(file.size)}</small></div>)}
      </div> : <AbilityEmptyState title="没有附属文件" description="该 Skill 只有一个 SKILL.md。" />)}
      {tab === 'permissions' && <div className="ability-detail-section">
        <dl className="ability-meta-list">
          <div><dt>执行本地代码</dt><dd>{hasScripts ? '包含脚本文件，启用后可能被 Agent 执行' : '仅文本指令'}</dd></div>
          <div><dt>文件访问</dt><dd>Skill 本身不直接访问文件，实际读写由 Agent 的工具权限决定</dd></div>
          <div><dt>网络访问</dt><dd>Skill 本身不发起网络请求</dd></div>
        </dl>
        <p className="settings-hint">来源为「{SOURCE_LABELS[detail.source]}」。未知来源的 Skill 可能包含可执行脚本，启用前请检查「文件」页内容。</p>
      </div>}
      {tab === 'usage' && <AbilityEmptyState
        title="还没有使用记录"
        description="能力被 Agent 实际调用后，这里会展示最近使用时间与调用次数。"
      />}
    </div>}
  </CapabilityDrawer>
}
