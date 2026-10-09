import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Boxes, Download, LoaderCircle, Package, RefreshCw, Search, ToggleRight, Wrench } from 'lucide-react'
import type { DshSearchHit } from '../../../../shared/types'
import { openExternalLink } from '../../../ai-response/response-context'
import { useAsyncActions } from '../../abilities/hooks/useAsyncAction'
import { AbilityEmptyState, AbilityLoadingState } from '../../abilities/components/AbilityEmptyState'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { useDshPlugins } from '../hooks/useDshPlugins'
import { MemoDshPluginCard } from '../components/PluginCard'
import { filterPlugins, hitState, installNotice, pluginStats, presentCompat, sortHits, type PluginFilter } from '../plugin-view'
import '../../feature-page.css'

const FILTERS: Array<[PluginFilter, string]> = [['all', '全部'], ['enabled', '已启用'], ['problem', '需要处理']]
const TABS: Array<['mine' | 'discover', string]> = [['mine', '我的插件'], ['discover', '发现插件']]

const HIT_LABEL: Record<ReturnType<typeof hitState>, string> = {
  installable: '安装',
  installed: '已安装',
  upgradable: '更新'
}

function StatCard({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: number | string; hint?: string; tone?: 'success' | 'danger' | 'accent' | 'muted' }) {
  return <div className="fp-stat">
    <span className={`fp-stat-icon ${tone === 'muted' ? '' : tone ?? ''}`}>{icon}</span>
    <div><strong className={typeof value === 'string' ? 'text' : ''}>{value}</strong><span>{label}</span>{hint && <small>{hint}</small>}</div>
  </div>
}

/**
 * dsh 插件页。与「能力」分开的理由：这里装的是会在宿主进程里执行的第三方代码，
 * 生命周期（挂载 / 激活 / 重启宿主）和 Skill、MCP 完全不是一回事。
 * 视觉沿用「能力」页的容器、卡片与色调，两个页面之间切换不应该有断层。
 */
export function DshPluginsPage({ onNotice }: { onNotice: (notice: string) => void }) {
  const { plugins, host, error, loading, refresh } = useDshPlugins()
  const actions = useAsyncActions()
  const [tab, setTab] = useState<'mine' | 'discover'>('mine')
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DshSearchHit[] | null>(null)

  const visible = useMemo(() => filterPlugins(plugins ?? [], filter, keyword), [plugins, filter, keyword])
  const stats = useMemo(() => pluginStats(plugins ?? []), [plugins])

  const toggle = useCallback(async (name: string, enabled: boolean) => {
    await actions.run(name, async () => {
      await window.fastAgent.dsh.setEnabled(name, enabled)
      await refresh()
      onNotice(enabled ? `已启用 ${name}` : `已停用 ${name}`)
    })
  }, [actions, refresh, onNotice])

  const uninstall = useCallback(async (name: string) => {
    await actions.run(name, async () => {
      await window.fastAgent.dsh.uninstall(name)
      await refresh()
      onNotice(`已卸载 ${name}`)
    })
  }, [actions, refresh, onNotice])

  const search = useCallback(async () => {
    const text = query.trim()
    if (!text) return
    await actions.run('search', async () => {
      setHits(sortHits(await window.fastAgent.dsh.search(text)))
    })
  }, [actions, query])

  const install = useCallback(async (name: string) => {
    await actions.run(`install:${name}`, async () => {
      const result = await window.fastAgent.dsh.install(name)
      await refresh()
      if (query.trim()) setHits(sortHits(await window.fastAgent.dsh.search(query.trim())))
      onNotice(installNotice(result))
    })
  }, [actions, refresh, onNotice, query])

  const remount = useCallback(async () => {
    await actions.run('remount', async () => {
      await window.fastAgent.dsh.remount()
      await refresh()
      onNotice('已重启插件宿主')
    })
  }, [actions, refresh, onNotice])

  const openHomepage = useCallback((url: string) => { void openExternalLink(url, onNotice) }, [onNotice])

  return <div className="section-view fp-shell">
    <div className="fp-page">
    <div className="fp-head">
      <div>
        <h1>插件</h1>
        <p>DeepSeek Harness 插件。已启用的插件在独立宿主进程中运行，向对话提供工具。</p>
      </div>
      <div className="fp-head-actions">
        <button className="quick-secondary" disabled={actions.isPending('remount')} onClick={() => void remount()}>
          {actions.isPending('remount') ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}重启宿主
        </button>
      </div>
    </div>

    <nav className="fp-tabs" role="tablist" aria-label="插件分区">
      {TABS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
      ))}
    </nav>

    <div className="capabilities-content">
      {tab === 'mine' && <div className="cap-tab-content">
        <div className="fp-stat-grid cols-5">
          <StatCard icon={<Boxes size={16} />} label="已安装" value={stats.total} hint="本地 dsh 插件" />
          <StatCard icon={<ToggleRight size={16} />} label="已启用" value={stats.enabled} hint="已挂载到宿主" tone="success" />
          <StatCard icon={<Wrench size={16} />} label="接入工具" value={stats.tools} hint="对话中可调用" />
          <StatCard
            icon={<AlertTriangle size={16} />}
            label="需要处理"
            value={stats.attention}
            hint={stats.attention ? '未激活或加载失败' : '暂无异常'}
            tone={stats.attention ? 'danger' : 'muted'}
          />
          <StatCard
            icon={<Package size={16} />}
            label="插件宿主"
            value={host ? `cordis ${host.runtimeVersion}` : '—'}
            hint={host?.error ? '宿主异常' : host?.running ? '运行中' : '未启动'}
            tone={host?.error ? 'danger' : host?.running ? 'success' : 'muted'}
          />
        </div>

        <div className="cap-warn-block">
          <AlertTriangle size={15} />
          <div>
            <strong>插件是第三方代码</strong>
            <span>
              运行在独立进程中，拿不到你的账号与本地数据库，但仍可读写文件与访问网络。只安装你信任的插件。
              {host && ` 当前宿主 cordis ${host.runtimeVersion}，只能加载兼容该大版本的插件。`}
            </span>
          </div>
        </div>
        {host?.error && <AbilityErrorBlock title="插件宿主异常" message={host.error} actions={
          <button className="small-control" onClick={() => void remount()}><RefreshCw size={13} />重启宿主</button>
        } />}

        {error ? <AbilityErrorBlock
          title="插件列表加载失败"
          message={error}
          actions={<button className="small-control" onClick={() => void refresh()}><RefreshCw size={13} />重试</button>}
        /> : loading && !plugins ? <AbilityLoadingState />
          : !plugins?.length ? <AbilityEmptyState
            title="还没有安装插件"
            description="dsh 插件发布在 npm 上，从「发现插件」按关键字搜索并安装。安装后默认停用，确认来源可信再启用。"
            action={<button className="primary-button" onClick={() => setTab('discover')}>去发现插件</button>}
          /> : <>
            <div className="cap-toolbar cap-mine-toolbar">
              <div className="cap-chips" role="group" aria-label="插件筛选">
                {FILTERS.map(([key, label]) => {
                  const count = key === 'all' ? stats.total : key === 'enabled' ? stats.enabled : stats.attention
                  return <button key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
                    {label}{count ? ` (${count})` : ''}
                  </button>
                })}
              </div>
              <div className="cap-search">
                <Search size={14} />
                <input value={keyword} placeholder="搜索我的插件…" aria-label="筛选已装插件" onChange={(event) => setKeyword(event.target.value)} />
              </div>
              <div className="cap-toolbar-spacer" />
            </div>
            {visible.length === 0 ? <p className="cap-empty-note">没有符合条件的插件</p>
              : <div className="ability-list">{visible.map((plugin) => (
                <MemoDshPluginCard
                  key={plugin.name}
                  plugin={plugin}
                  pending={actions.isPending(plugin.name)}
                  error={actions.errorOf(plugin.name)}
                  onToggle={(enabled) => void toggle(plugin.name, enabled)}
                  onUninstall={() => void uninstall(plugin.name)}
                  onOpenHomepage={openHomepage}
                />
              ))}</div>}
            <p className="settings-hint">只有启用的插件会挂载到宿主并把工具接入对话。插件代码在宿主进程中执行，启用前请确认来源。</p>
          </>}
      </div>}

      {tab === 'discover' && <div className="cap-tab-content">
        <div className="cap-toolbar">
          <div className="cap-search">
            <Search size={14} />
            <input
              value={query}
              placeholder="在 npm 上按关键字搜索 dsh 插件"
              aria-label="搜索 dsh 插件"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void search() }}
            />
          </div>
          <button className="primary-button" disabled={actions.isPending('search') || !query.trim()} onClick={() => void search()}>
            {actions.isPending('search') ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}搜索
          </button>
          <div className="cap-toolbar-spacer" />
        </div>
        {actions.errorOf('search') && <AbilityErrorBlock title="搜索失败" message={actions.errorOf('search') as string} />}
        {hits === null ? <AbilityEmptyState
          title="搜索 npm 上的 dsh 插件"
          description="dsh 插件以 npm 包的形式发布。输入关键字开始搜索，安装后默认停用。"
        />
          : hits.length === 0 ? <p className="cap-empty-note">没有匹配的包</p>
            : <div className="ability-list">{hits.map((hit) => {
              const state = hitState(hit)
              const key = `install:${hit.name}`
              const compat = presentCompat(hit)
              const blocked = hit.compat?.level === 'block'
              return <div className="ability-row ability-card" key={hit.name}>
                <div className="ability-row-main">
                  <div className="ability-row-title">
                    <span className="cap-row-icon"><Package size={14} /></span>
                    <strong>{hit.name}</strong>
                    {state !== 'installable' && <span className={`ability-badge ${state === 'installed' ? 'tone-muted' : 'tone-warn'}`}>{HIT_LABEL[state]}</span>}
                    {compat && <span className={`ability-badge tone-${compat.tone}`} title={compat.detail}>{compat.label}</span>}
                  </div>
                  <small>{hit.description}</small>
                  <div className="ability-row-meta">
                    <span>v{hit.version}</span>
                    {hit.author && <span>{hit.author}</span>}
                    {hit.installedVersion && <span>已装 v{hit.installedVersion}</span>}
                  </div>
                  {compat && <small className={`dsh-compat-note ${compat.tone}`}>{compat.detail}</small>}
                  {actions.errorOf(key) && <AbilityErrorBlock message={actions.errorOf(key) as string} />}
                </div>
                <div className="ability-row-actions">
                  {hit.homepage && <button className="small-control" onClick={() => openHomepage(hit.homepage as string)}>主页</button>}
                  <button
                    className="primary-button"
                    disabled={actions.isPending(key) || state === 'installed' || blocked}
                    title={blocked ? compat?.detail : undefined}
                    onClick={() => void install(hit.name)}
                  >
                    {actions.isPending(key) ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{HIT_LABEL[state]}
                  </button>
                </div>
              </div>
            })}</div>}
      </div>}
    </div>
    </div>
  </div>
}
