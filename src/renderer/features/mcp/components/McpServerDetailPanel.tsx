import { useEffect, useState } from 'react'
import type { McpAbility, McpPromptDescriptor, McpPromptResult, McpResourceContent, McpResourceDescriptor, McpResourceTemplateDescriptor, McpServerDetail } from '../../../../shared/types'
import { CapabilityDrawer } from '../../abilities/components/CapabilityDrawer'
import { AbilityErrorBlock } from '../../abilities/components/AbilityErrorBlock'
import { AbilityEmptyState, AbilityLoadingState } from '../../abilities/components/AbilityEmptyState'
import { AbilityStatusBadge } from '../../abilities/components/AbilityStatusBadge'
import { connectionPresentation, SOURCE_LABELS, transportLabel } from '../../abilities/ability-view'
import { Plug } from 'lucide-react'
import { mcpService } from '../services/mcp-service'
import { expandMcpResourceTemplate, promptResultText } from '../mcp-view'

type DetailTab = 'overview' | 'tools' | 'resources' | 'prompts' | 'config'

const TABS: Array<[DetailTab, string]> = [
  ['overview', '概览'],
  ['tools', 'Tools'],
  ['resources', 'Resources'],
  ['prompts', 'Prompts'],
  ['config', '配置']
]

export function McpServerDetailPanel({ ability, onClose, onEdit, onReconnect, onInsertComposer }: {
  ability: McpAbility
  onClose: () => void
  onEdit: () => void
  onReconnect: () => void
  onInsertComposer?: (text: string) => void
}) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [detail, setDetail] = useState<McpServerDetail | null>(null)
  const [resources, setResources] = useState<McpResourceDescriptor[]>([])
  const [templates, setTemplates] = useState<McpResourceTemplateDescriptor[]>([])
  const [prompts, setPrompts] = useState<McpPromptDescriptor[]>([])
  const [selectedResource, setSelectedResource] = useState<McpResourceDescriptor | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<McpResourceTemplateDescriptor | null>(null)
  const [resourceTemplateArgs, setResourceTemplateArgs] = useState<Record<string, string>>({})
  const [resourceContents, setResourceContents] = useState<McpResourceContent[]>([])
  const [selectedPrompt, setSelectedPrompt] = useState<McpPromptDescriptor | null>(null)
  const [promptArgs, setPromptArgs] = useState<Record<string, string>>({})
  const [promptResult, setPromptResult] = useState<McpPromptResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDetail(null)
    setError(null)
    void mcpService.detail(ability.id)
      .then(setDetail)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'MCP Server 详情加载失败'))
    void mcpService.resources(ability.id)
      .then((result) => { setResources(result.resources); setTemplates(result.templates) })
      .catch(() => { setResources([]); setTemplates([]) })
    void mcpService.prompts(ability.id)
      .then((result) => setPrompts(result.prompts))
      .catch(() => setPrompts([]))
  }, [ability.id])

  const connection = detail?.connection ?? ability.connection

  return <CapabilityDrawer
    title={ability.displayName}
    subtitle={`${transportLabel(ability)} · ${SOURCE_LABELS[ability.source]}`}
    icon={<Plug size={15} />}
    badges={<>
      {(connection.state === 'error' || ability.status === 'config_required' || ability.status === 'update_available')
        && <AbilityStatusBadge status={ability.status === 'config_required' ? { label: '需要配置', tone: 'warn' } : ability.status === 'update_available' ? { label: '有更新', tone: 'warn' } : connectionPresentation(connection.state)} />}
      <AbilityStatusBadge status={{ label: ability.enabled ? 'Agent 可用' : 'Agent 停用', tone: ability.enabled ? 'ok' : 'muted' }} />
    </>}
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
      {tab === 'resources' && <div className="ability-detail-section">
        {resources.length || templates.length ? <>
          {resources.length > 0 && <div className="cap-tools">{resources.map((resource) => <button className="cap-tool-row" key={resource.uri} onClick={() => { setSelectedResource(resource); setResourceContents([]); void mcpService.readResource(ability.id, resource.uri).then((result) => setResourceContents(result.contents)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Resource 读取失败')) }}><div className="cap-tool-copy"><strong>{resource.title ?? resource.name}</strong><small>{resource.uri}{resource.description ? ` · ${resource.description}` : ''}</small></div><span className="cap-tool-risk read">读取</span></button>)}</div>}
          {templates.length > 0 && <>
            <div className="cap-section-heading"><span>Resource Templates</span><small>{templates.length}</small></div>
            <div className="cap-tools">{templates.map((template) => <button className="cap-tool-row" key={template.uriTemplate} onClick={() => { setSelectedTemplate(template); setResourceTemplateArgs({}); setResourceContents([]) }}><div className="cap-tool-copy"><strong>{template.title ?? template.name}</strong><small>{template.uriTemplate}</small></div><span className="cap-tool-risk read">展开</span></button>)}</div>
          </>}
          {selectedTemplate && <div className="ability-detail-section"><div className="cap-section-heading"><span>{selectedTemplate.name}</span><small>填写模板变量</small></div>{[...selectedTemplate.uriTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => { const key = match[1]; return <label className="ability-form-field" key={key}><span>{key}</span><input value={resourceTemplateArgs[key] ?? ''} onChange={(event) => setResourceTemplateArgs((current) => ({ ...current, [key]: event.target.value }))} /></label> })}<button className="quick-secondary" onClick={() => { const uri = expandMcpResourceTemplate(selectedTemplate.uriTemplate, resourceTemplateArgs); setSelectedResource({ uri, name: selectedTemplate.name, mimeType: selectedTemplate.mimeType }); void mcpService.readResource(ability.id, uri).then((result) => setResourceContents(result.contents)).catch((cause) => setError(cause instanceof Error ? cause.message : 'Resource 读取失败')) }}>读取模板资源</button></div>}
          {selectedResource && <div className="ability-detail-section"><div className="cap-section-heading"><span>{selectedResource.name}</span><small>{selectedResource.mimeType ?? '内容'}</small></div>{resourceContents.map((content, index) => <pre className="ability-code-block" key={`${content.uri}-${index}`}>{content.text ?? (content.blob ? '[二进制内容，已返回 base64]' : '')}</pre>)}</div>}
        </> : <AbilityEmptyState title="没有可展示的 Resources" description="Server 未公开 Resources，或读取失败。" action={<button className="quick-secondary" onClick={onReconnect}>重新连接</button>} />}
      </div>}
      {tab === 'prompts' && <div className="ability-detail-section">
        {prompts.length ? <div className="cap-tools">{prompts.map((prompt) => <button className="cap-tool-row" key={prompt.name} onClick={() => { setSelectedPrompt(prompt); setPromptArgs({}); setPromptResult(null); setError(null) }}><div className="cap-tool-copy"><strong>{prompt.title ?? prompt.name}</strong>{prompt.description && <small>{prompt.description}</small>}</div><span className="cap-tool-risk read">选择</span></button>)}</div> : <AbilityEmptyState title="没有可展示的 Prompts" description="Server 未公开 Prompts，或读取失败。" action={<button className="quick-secondary" onClick={onReconnect}>重新连接</button>} />}
        {selectedPrompt && <div className="ability-detail-section">
          <div className="cap-section-heading"><span>{selectedPrompt.name}</span><small>{selectedPrompt.arguments?.length ?? 0} 个参数</small></div>
          {(selectedPrompt.arguments ?? []).map((argument) => <label className="ability-form-field" key={argument.name}><span>{argument.name}{argument.required ? ' *' : ''}</span><input value={promptArgs[argument.name] ?? ''} placeholder={argument.description} onChange={(event) => setPromptArgs((current) => ({ ...current, [argument.name]: event.target.value }))} /></label>)}
          <button className="quick-secondary" onClick={() => void mcpService.getPrompt(ability.id, selectedPrompt.name, promptArgs).then(setPromptResult).catch((cause) => setError(cause instanceof Error ? cause.message : 'Prompt 获取失败'))}>获取 Prompt</button>
        </div>}
        {selectedPrompt && promptResult && <div className="ability-detail-section"><div className="cap-section-heading"><span>展开结果</span><small>{promptResult.messages.length} 条消息</small></div><button className="quick-secondary" onClick={() => onInsertComposer?.(promptResultText(promptResult))}>插入 Composer</button>{promptResult.messages.map((message, index) => <pre className="ability-code-block" key={index}>{typeof message.content === 'string' ? message.content : JSON.stringify(message.content, null, 2)}</pre>)}</div>}
      </div>}
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
