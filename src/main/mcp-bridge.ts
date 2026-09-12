import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { Type, type TSchema } from 'typebox'
import type { McpToolBinding } from './mcp-manager'

/** 把 MCP 服务器返回的 JSON Schema 转成 TypeBox 校验结构；只处理基础类型，忽略高级关键字。 */
export function jsonSchemaToTypeBox(schema: Record<string, unknown> | undefined): TSchema {
  const object = (schema ?? {}) as { type?: unknown; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: unknown }
  if (object.type !== 'object' || !object.properties) return Type.Object({}, { additionalProperties: true })
  const required = new Set(Array.isArray(object.required) ? object.required.filter((item): item is string => typeof item === 'string') : [])
  const properties: Record<string, TSchema> = {}
  for (const [key, raw] of Object.entries(object.properties)) {
    const property = raw as { type?: unknown; properties?: Record<string, unknown> }
    let value: TSchema
    switch (property.type) {
      case 'string': value = Type.String(); break
      case 'number':
      case 'integer': value = Type.Number(); break
      case 'boolean': value = Type.Boolean(); break
      case 'array': value = Type.Array(Type.Unknown()); break
      case 'object': value = jsonSchemaToTypeBox(property); break
      default: value = Type.Unknown(); break
    }
    properties[key] = required.has(key) ? value : Type.Optional(value)
  }
  return Type.Object(properties)
}

/** 内联 MCP 桥接扩展：把已连接并授权的 MCP 工具注册进 pi 工具集，调用时转发并传递取消信号。 */
export function createMcpBridgeExtension(bindings: McpToolBinding[]): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    for (const binding of bindings) {
      pi.registerTool({
        name: binding.name,
        label: binding.name,
        description: binding.description,
        parameters: jsonSchemaToTypeBox(binding.inputSchema),
        async execute(_toolCallId, params, signal) {
          return binding.execute(params as Record<string, unknown>, signal ?? new AbortController().signal)
        }
      })
    }
  }
}