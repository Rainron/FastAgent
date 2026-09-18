import { Boxes, CircleCheck, Plug, ToggleRight, Wrench } from 'lucide-react'
import type { Ability } from '../../../../shared/types'
import { abilitiesNeedingAttention, abilityStats, abilityStatusPresentation, recentlyInstalledAbilities, recentlyUsedAbilities, SOURCE_LABELS } from '../ability-view'
import { AbilityStatusBadge } from '../components/AbilityStatusBadge'

function StatCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number | string; hint?: string; tone?: 'success' | 'danger' | 'accent' | 'muted' }) {
  return <div className="cap-stat-card">
    <div className={`cap-stat-icon ${tone ?? ''}`}>{icon}</div>
    <div className="cap-stat-copy"><strong>{value}</strong><span>{label}</span>{hint && <small>{hint}</small>}</div>
  </div>
}

function formatInstalledAt(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 使用时间比安装时间粒度要细：当天用过的看时分更有意义。 */
function formatUsedAt(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const sameDay = new Date().toDateString() === date.toDateString()
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function AbilityRow({ ability, onOpen, trailing }: { ability: Ability; onOpen: () => void; trailing: React.ReactNode }) {
  return <button className="cap-overview-row" onClick={onOpen}>
    <span className="cap-row-icon">{ability.type === 'skill' ? <Wrench size={13} /> : <Plug size={13} />}</span>
    <span className="cap-overview-row-copy">
      <strong>{ability.displayName}</strong>
      <small>{ability.error?.message ?? ability.description ?? SOURCE_LABELS[ability.source]}</small>
    </span>
    {trailing}
  </button>
}

export function OverviewTab({ abilities, onOpen }: { abilities: Ability[]; onOpen: (ability: Ability) => void }) {
  const stats = abilityStats(abilities)
  const healthy = stats.connectionFailed === 0
  const attention = abilitiesNeedingAttention(abilities)
  const recent = recentlyInstalledAbilities(abilities)
  const used = recentlyUsedAbilities(abilities)

  return <div className="cap-tab-content">
    <div className="cap-stats-grid">
      <StatCard icon={<Boxes size={16} />} label="全部能力" value={stats.total} hint="Skill 与 MCP Server 合计" />
      <StatCard icon={<Wrench size={16} />} label="Skills" value={stats.skills} hint="任务知识与工作流" />
      <StatCard icon={<Plug size={16} />} label="MCP Servers" value={stats.mcp} hint="外部工具与数据源" />
      <StatCard icon={<ToggleRight size={16} />} label="已启用" value={stats.enabled} hint="Agent 可发现" tone="success" />
      <StatCard
        icon={<CircleCheck size={16} />}
        label="运行状态"
        value={`${stats.connectionOk} 正常 · ${stats.connectionFailed} 异常`}
        hint={healthy ? '最近检测无异常' : '存在连接失败的 Server'}
        tone={healthy ? 'success' : 'danger'}
      />
    </div>

    <section className="cap-overview-section">
      <div className="cap-section-heading"><span>需要处理</span>{attention.length > 0 && <small>{attention.length}</small>}</div>
      {attention.length === 0
        ? <p className="cap-overview-hint">已安装的能力状态都正常，没有待处理项。</p>
        : <div className="cap-overview-list">{attention.map((ability) => <AbilityRow
            key={ability.id}
            ability={ability}
            onOpen={() => onOpen(ability)}
            trailing={<AbilityStatusBadge status={abilityStatusPresentation(ability.status)} />}
          />)}</div>}
    </section>

    <section className="cap-overview-section">
      <div className="cap-section-heading"><span>最近安装</span></div>
      {recent.length === 0
        ? <p className="cap-overview-hint">还没有安装记录。从插件市场安装、本地导入或手动创建后会出现在这里。</p>
        : <div className="cap-overview-list">{recent.map((ability) => <AbilityRow
            key={ability.id}
            ability={ability}
            onOpen={() => onOpen(ability)}
            trailing={<span className="cap-overview-time">{formatInstalledAt(ability.installedAt)}</span>}
          />)}</div>}
    </section>

    <section className="cap-overview-section">
      <div className="cap-section-heading"><span>最近使用</span></div>
      {used.length === 0
        ? <p className="cap-overview-hint">还没有使用记录。能力被 Agent 实际调用后会按时间出现在这里。</p>
        : <div className="cap-overview-list">{used.map((ability) => <AbilityRow
            key={ability.id}
            ability={ability}
            onOpen={() => onOpen(ability)}
            trailing={<span className="cap-overview-time">{formatUsedAt(ability.lastUsedAt)}</span>}
          />)}</div>}
    </section>
  </div>
}
