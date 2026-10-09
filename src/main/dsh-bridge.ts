import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { jsonSchemaToTypeBox } from './mcp-bridge'
import { TOOL_KEY_MAP } from '../shared/permission-rules'
import type { DshPluginActivation } from '../shared/types'

/**
 * 桥接只需要「能执行一个工具」这一件事。
 * 收窄成接口是为了不把 electron（DshHostClient 依赖它）拖进 pi-runtime 的依赖图。
 */
export interface DshHostLike {
  execute(callId: string, tool: string, args: unknown, signal: AbortSignal): Promise<{ isError: boolean; text: string }>
}

/** 一个 dsh 插件工具在 pi 侧的绑定；schema 由宿主的 ToolRuntime.schemas() 直接给出。 */
export interface DshToolBinding {
  /** 提供该工具的插件包名，用于记录用量与定位来源 */
  pluginName: string
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * dsh 桥接扩展：把宿主里已激活插件注册的工具接进 pi 工具集。
 * 与 createMcpBridgeExtension 同构——dsh 的 schemas() 产出的就是标准 JSON Schema，
 * 所以这里复用同一个 jsonSchemaToTypeBox，不再单独写一套转换。
 */
export function createDshBridgeExtension(
  bindings: DshToolBinding[],
  host: DshHostLike,
  onPluginUsed?: (pluginName: string) => void
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const binding of bindings) {
      pi.registerTool({
        name: binding.name,
        label: binding.name,
        description: binding.description,
        parameters: jsonSchemaToTypeBox(binding.parameters),
        async execute(toolCallId, params, signal) {
          onPluginUsed?.(binding.pluginName)
          const result = await host.execute(toolCallId, binding.name, params, signal ?? new AbortController().signal)
          // dsh 的 isError 映射成抛错：pi 会把它渲染成工具失败，同时把正文带回模型，
          // 模型才有机会自我纠正。吞掉错误标记会让失败看起来像成功。
          if (result.isError) throw new Error(result.text)
          return { content: [{ type: 'text' as const, text: result.text }], details: { plugin: binding.pluginName } }
        }
      })
    }
  }
}

/**
 * pi 里扩展注册的工具会覆盖同名内置工具（后注册者胜）。插件若注册 bash / read 这类名字，
 * 就等于绕过沙箱与权限映射接管了内置实现，所以这些名字与保留前缀一律不让插件占用。
 */
const RESERVED_TOOL_NAMES = new Set([...Object.keys(TOOL_KEY_MAP), 'read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'skill', 'agent', 'subagent'])
const RESERVED_TOOL_PREFIXES = ['mcp__', 'cli__', 'computer_']

export function isReservedToolName(name: string): boolean {
  return RESERVED_TOOL_NAMES.has(name) || RESERVED_TOOL_PREFIXES.some((prefix) => name.startsWith(prefix))
}

/**
 * 从宿主的激活结果里挑出可接入对话的工具。保留名不接；两个插件注册同名工具时先挂载者保留，
 * 后者的那个工具不接——同名注册在 pi 里会静默互相覆盖，用户看到的工具和实际执行的对不上。
 * 被挡下的工具名记回激活结果，界面据此说明「为什么少了工具」。
 */
export function selectDshBindings(activations: Record<string, DshPluginActivation>): { bindings: DshToolBinding[]; activations: Record<string, DshPluginActivation> } {
  const taken = new Set<string>()
  const bindings: DshToolBinding[] = []
  const next: Record<string, DshPluginActivation> = {}
  for (const [pluginName, activation] of Object.entries(activations)) {
    if (activation.status !== 'active') { next[pluginName] = activation; continue }
    const accepted = activation.tools.filter((tool) => !isReservedToolName(tool.name) && !taken.has(tool.name))
    const conflicts = activation.tools.filter((tool) => !accepted.includes(tool)).map((tool) => tool.name)
    for (const tool of accepted) {
      taken.add(tool.name)
      bindings.push({ pluginName, name: tool.name, description: tool.description, parameters: tool.parameters })
    }
    next[pluginName] = conflicts.length ? { status: 'active', tools: accepted, conflicts } : { status: 'active', tools: accepted }
  }
  return { bindings, activations: next }
}
