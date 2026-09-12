import { useMemo, useState } from 'react'
import { Edit3, FolderOpen, Info, LoaderCircle, MoreHorizontal, RefreshCw, Search, Trash2, Wrench } from 'lucide-react'
import type { SkillAbility } from '../../../../shared/types'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { AbilityEmptyState } from '../../abilities/components/AbilityEmptyState'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityMenu } from '../../abilities/components/AbilityMenu'
import { abilityStatusPresentation, filterAbilities, SOURCE_LABELS, sortAbilities, canUninstall, type AbilitySort, type AbilitySourceFilter, type AbilityStatusFilter } from '../../abilities/ability-view'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { abilitiesService } from '../../abilities/services/abilities-service'
import { skillsService } from '../services/skills-service'

const STATUS_FILTERS: Array<[AbilityStatusFilter, string]> = [
  ['all', '全部'],
  ['enabled', '已启用'],
  ['disabled', '已禁用'],
  ['error', '异常'],
  ['update_available', '有更新']
]

export function SkillList({ skills, onRefresh, onNotice, onEdit, onInspect, onCreate, onImport, onOpenPlugins }: {
  skills: SkillAbility[]
  onRefresh: () => Promise<void>
  onNotice: (notice: string) => void
  onEdit: (name: string) => void
  onInspect: (ability: SkillAbility) => void
  onCreate: () => void
  onImport: () => void
  onOpenPlugins?: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<AbilityStatusFilter>('all')
  const [source, setSource] = useState<AbilitySourceFilter>('all')
  // Skill 的 status 基本等价于启用与否，默认按状态排会让「启用一个就跳位」，
  // 连点第二下打到的是另一个 Skill。默认按名称，按状态仍可手动选。
  const [sort, setSort] = useState<AbilitySort>('name')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const actions = useAsyncActions()

  const visible = useMemo(
    () => sortAbilities(filterAbilities(skills, { keyword, status, source }), sort),
    [skills, keyword, status, source, sort]
  )
  const selectedVisible = visible.filter((ability) => selected.has(ability.id))
  const batchPending = actions.isPending('batch')

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  async function toggle(ability: SkillAbility) {
    await actions.run(`toggle:${ability.id}`, () => abilitiesService.setEnabled('skill', ability.id, !ability.enabled))
    await onRefresh()
  }

  async function applyBatch(enabled: boolean) {
    const targets = selectedVisible.filter((ability) => ability.enabled !== enabled)
    if (!targets.length) { setSelected(new Set()); return }
    await actions.run('batch', async () => {
      // 串行：并发写同一份启用状态没有收益，出错时也定位不到是哪一个。
      for (const ability of targets) await abilitiesService.setEnabled('skill', ability.id, enabled)
    })
    onNotice(`已${enabled ? '启用' : '停用'} ${targets.length} 个 Skill`)
    setSelected(new Set())
    await onRefresh()
  }

  async function uninstall(ability: SkillAbility) {
    await actions.run(`remove:${ability.id}`, async () => {
      await skillsService.remove(ability.name)
      onNotice(`已卸载 Skill：${ability.name}`)
    })
    await onRefresh()
  }

  async function openLocation(ability: SkillAbility) {
    const result = await actions.run(`open:${ability.id}`, () => abilitiesService.openLocation('skill', ability.id))
    if (result) onNotice(result)
  }

  return <div className="cap-tab-content">
    <div className="cap-toolbar">
      <div className="cap-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索 Skill…" aria-label="搜索 Skill" /></div>
      <div className="settings-shell-segmented" role="group" aria-label="Skill 状态筛选">
        {STATUS_FILTERS.map(([key, label]) => <button key={key} className={status === key ? 'active' : ''} onClick={() => setStatus(key)}>{label}</button>)}
      </div>
      <label className="ability-select"><span>来源</span>
        <select value={source} onChange={(event) => setSource(event.target.value as AbilitySourceFilter)}>
          <option value="all">全部</option>
          {(Object.keys(SOURCE_LABELS) as Array<keyof typeof SOURCE_LABELS>).map((key) => <option key={key} value={key}>{SOURCE_LABELS[key]}</option>)}
        </select>
      </label>
      <label className="ability-select"><span>排序</span>
        <select value={sort} onChange={(event) => setSort(event.target.value as AbilitySort)}>
          <option value="status">按状态</option>
          <option value="name">按名称</option>
          <option value="recent">按安装时间</option>
        </select>
      </label>
      <div className="cap-toolbar-spacer" />
      <button className="quick-secondary" onClick={onImport}>导入 Skill</button>
      <button className="primary-button" onClick={onCreate}>新建 Skill</button>
    </div>

    {visible.length === 0 ? (
      skills.length === 0
        ? <AbilityEmptyState
            title="还没有任何 Skill"
            description="Skill 提供任务知识与工作流。可以从插件市场安装，也可以手动创建或从本地导入。"
            action={<>
              {onOpenPlugins && <button className="primary-button" onClick={onOpenPlugins}>去插件市场</button>}
              <button className="quick-secondary" onClick={onCreate}>新建 Skill</button>
              <button className="quick-secondary" onClick={onImport}>从本地导入</button>
            </>}
          />
        : <AbilityEmptyState title="没有匹配的 Skill" description="调整关键词或筛选条件后再试。" action={<button className="quick-secondary" onClick={() => { setKeyword(''); setStatus('all'); setSource('all') }}>清除筛选</button>} />
    ) : (
      <>
      <div className="ability-batch">
        <label className="ability-select-box">
          <input
            type="checkbox"
            checked={selectedVisible.length > 0 && selectedVisible.length === visible.length}
            ref={(node) => { if (node) node.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length }}
            onChange={() => setSelected(selectedVisible.length === visible.length ? new Set() : new Set(visible.map((ability) => ability.id)))}
            aria-label="全选当前列表"
          />
        </label>
        <span>{selectedVisible.length ? `已选 ${selectedVisible.length} 个` : '选择后可批量启停'}</span>
        <div className="cap-toolbar-spacer" />
        <button className="small-control" disabled={!selectedVisible.length || batchPending} onClick={() => void applyBatch(true)}>批量启用</button>
        <button className="small-control" disabled={!selectedVisible.length || batchPending} onClick={() => void applyBatch(false)}>批量停用</button>
        {batchPending && <LoaderCircle size={13} className="spin" />}
      </div>
      {actions.errorOf('batch') && <AbilityErrorBlock title="批量操作失败" message={actions.errorOf('batch') as string} />}
      <div className="ability-list">
        {visible.map((ability) => {
          const busy = actions.isPending(`toggle:${ability.id}`) || actions.isPending(`remove:${ability.id}`)
          const error = actions.errorOf(`toggle:${ability.id}`) ?? actions.errorOf(`remove:${ability.id}`)
          return <div className="ability-row" key={ability.id}>
            <label className="ability-select-box">
              <input type="checkbox" checked={selected.has(ability.id)} onChange={() => toggleSelected(ability.id)} aria-label={`选择 ${ability.displayName}`} />
            </label>
            <div className="ability-row-main">
              <div className="ability-row-title">
                <span className="cap-row-icon"><Wrench size={14} /></span>
                <strong>{ability.displayName}</strong>
                <AbilityStatusBadge status={abilityStatusPresentation(ability.status)} />
              </div>
              <small>{ability.description}</small>
              <div className="ability-row-meta">
                <span className="mono">{ability.name}</span>
                <span>{SOURCE_LABELS[ability.source]}</span>
                {ability.version && <span>v{ability.version}</span>}
                {ability.author && <span>{ability.author}</span>}
              </div>
              {error && <AbilityErrorBlock message={error} actions={<>
                <button className="small-control" onClick={() => void onRefresh()}><RefreshCw size={13} />重试</button>
                <button className="small-control" onClick={() => onInspect(ability)}><Info size={13} />查看详情</button>
              </>} />}
            </div>
            <div className="ability-row-actions">
              <label className="switch-row" title="启用后 Agent 会按需加载该 Skill">
                <input type="checkbox" checked={ability.enabled} disabled={busy} onChange={() => void toggle(ability)} />
                <span className="switch-visual" />
                <span>{busy ? <LoaderCircle size={12} className="spin" /> : ability.enabled ? 'Agent 可用' : 'Agent 停用'}</span>
              </label>
              <AbilityMenu
                label={`${ability.displayName} 的更多操作`}
                trigger={<MoreHorizontal size={15} />}
                items={[
                  { key: 'detail', label: '查看详情', icon: <Info size={13} />, onSelect: () => onInspect(ability) },
                  { key: 'edit', label: '编辑内容', icon: <Edit3 size={13} />, onSelect: () => onEdit(ability.name) },
                  { key: 'open', label: '打开目录', icon: <FolderOpen size={13} />, onSelect: () => void openLocation(ability) },
                  ...(canUninstall(ability) ? [{ key: 'remove', label: '卸载', icon: <Trash2 size={13} />, danger: true, onSelect: () => void uninstall(ability) }] : [])
                ]}
              />
            </div>
          </div>
        })}
      </div>
      </>
    )}
    <p className="settings-hint">只有启用的 Skill 会被 Agent 加载。含可执行脚本的 Skill 视为不可信输入，启用前请检查来源。</p>
  </div>
}
