import { useEffect, useState } from 'react'
import type { McpAbility, McpServerDetail } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityEmptyState, AbilityLoadingState } from '../../abilities/components/AbilityEmptyState'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { connectionPresentation, SOURCE_LABELS, transportLabel } from '../../abilities/ability-view'
import { mcpService } from '../services/mcp-service'

type DetailTab = 'overview' | 'tools' | 'resources' | 'prompts' | 'config'

const TABS: Array<[DetailTab, string]> = [
  ['overview', '概览'],
  ['tools', 'Tools'],
  ['resources', 'Resources'],
  ['prompts', 'Prompts'],
  ['config', '配置']
]

export function McpServerDetailPanel({ ability, onClose, onEdit, onReconnect }: {
  ability: McpAbility
  onClose: () => void
  onEdit: () => void
  onReconnect: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [detail, setDetail] = useState<McpServerDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setError(null)
    void mcpService.detail(ability.id)
      .then(setDetail)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'MCP Server 详情加载失败'))
  }, [ability.id])

  const connection = detail?.connection ?? ability.connection

  return <CapabilityDrawer
    title={ability.displayName}
    subtitle={`${transportLabel(ability)} · ${SOURCE_LABELS[ability.source]}`}
    onClose={onClose}
    footer={<>
      <button className="quick-secondary" onClick={onReconnect}>重新连接</button>
      <button className="quick-secondary" onClick={onEdit}>编辑配置</button>
    </>}
  >
    <nav className="ability-detail-tabs" role="tablist" aria-label="MCP Server 详情">
      {TABS.map(([key, label]) => (
        <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
      ))}
    </nav>
    {error ? <AbilityErrorBlock title="详情加载失败" message={error} /> : !detail ? <AbilityLoadingState /> : <div className="ability-detail-body">
      {tab === 'overview' && <>
        <dl className="ability-meta-list">
          <div><dt>连接状态</dt><dd><AbilityStatusBadge status={connectionPresentation(connection.state)} /></dd></div>
          <div><dt>最近检测</dt><dd>{connection.testedAt ? new Date(connection.testedAt).toLocaleString() : '尚未检测'}</dd></div>
          <div><dt>传输方式</dt><dd>{transportLabel(ability)}</dd></div>
          <div><dt>能力数量</dt><dd>Tools {connection.toolCount} · Resources {connection.resourceCount} · Prompts {connection.promptCount}</dd></div>
          <div><dt>调用超时</dt><dd>{ability.timeoutMs} ms</dd></div>
          <div><dt>来源</dt><dd>{SOURCE_LABELS[detail.source]}{detail.pluginId ? ` · ${detail.pluginId}` : ''}</dd></div>
          <div><dt>添加时间</dt><dd>{detail.installedAt ? new Date(detail.installedAt).toLocaleString() : '未知'}</dd></div>
        </dl>
        {connection.state === 'error' && <AbilityErrorBlock
          title="最近一次连接失败"
          message={connection.error ?? '未知错误'}
          actions={<>
            <button className="small-control" onClick={onEdit}>编辑配置</button>
            <button className="small-control" onClick={onReconnect}>重新连接</button>
          </>}
        />}
        <p className="settings-hint">连接在每轮 Agent 运行时按启用状态建立、结束后关闭，因此这里展示的是最近一次检测结果，不提供常驻进程信息与实时日志。</p>
      </>}
      {tab === 'tools' && (connection.tools.length ? <div className="cap-tools">
        {connection.tools.map((tool) => {
          const readOnly = tool.annotations?.readOnlyHint && !tool.annotations?.destructiveHint
          return <div className="cap-tool-row" key={tool.name}>
            <div className="cap-tool-copy"><strong>{tool.name}</strong>{tool.description && <small>{tool.description}</small>}</div>
            <span className={`cap-tool-risk ${readOnly ? 'read' : 'write'}`}>{readOnly ? '只读' : '可写'}</span>
          </div>
        })}
      </div> : <AbilityEmptyState title="没有可展示的 Tools" description={connection.state === 'unknown' ? '尚未检测连接，先执行一次「重新连接」。' : 'Server 未公开任何工具。'} action={<button className="quick-secondary" onClick={onReconnect}>重新连接</button>} />)}
      {tab === 'resources' && <AbilityEmptyState title={`Resources：${connection.resourceCount}`} description={connection.resourceCount ? '当前只在检测时统计数量；资源清单会在 Agent 运行时按需读取。' : 'Server 未公开 Resources，或尚未检测。'} />}
      {tab === 'prompts' && <AbilityEmptyState title={`Prompts：${connection.promptCount}`} description={connection.promptCount ? '当前只在检测时统计数量；提示词清单会在 Agent 运行时按需读取。' : 'Server 未公开 Prompts，或尚未检测。'} />}
      {tab === 'config' && <div className="ability-detail-section">
        <dl className="ability-meta-list">
          <div><dt>标识</dt><dd className="mono">{detail.server.id}</dd></div>
          {ability.transport === 'stdio' ? <>
            <div><dt>命令</dt><dd className="mono">{detail.server.command ?? '未配置'}</dd></div>
            <div><dt>参数</dt><dd className="mono">{detail.server.args?.join(' ') || '无'}</dd></div>
            <div><dt>工作目录</dt><dd className="mono">{detail.server.cwd || '默认'}</dd></div>
          </> : <div><dt>URL</dt><dd className="mono">{detail.server.url ?? '未配置'}</dd></div>}
        </dl>
        <div className="ability-detail-section">
          <div className="cap-section-heading"><span>{ability.transport === 'stdio' ? '环境变量' : '请求头'}</span><small>值已遮挡</small></div>
          {(ability.transport === 'stdio' ? detail.envKeys : detail.headerKeys).length ? <div className="ability-file-list">
            {(ability.transport === 'stdio' ? detail.envKeys : detail.headerKeys).map((item) => (
              <div className="ability-file-row" key={item.key}><span className="mono">{item.key}</span><small>{item.hasValue ? '••••••' : '未设置'}</small></div>
            ))}
          </div> : <AbilityEmptyState title="没有配置密钥" description="该 Server 不需要密钥，或尚未填写。" />}
        </div>
        <p className="settings-hint">密钥值经系统加密保存在本机，界面与日志都不会回显具体内容。</p>
      </div>}
    </div>}
  </CapabilityDrawer>
}
